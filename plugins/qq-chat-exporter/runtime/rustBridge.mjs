import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BRIDGE_BODY_BYTES = 64 * 1024 * 1024;
const BRIDGE_HOST = '127.0.0.1';
const DEFAULT_BRIDGE_PORT = 40654;
const API_PORT = Number(process.env.QCE_SERVER_PORT || 40653);

export function resolveBridgePort(env = process.env) {
  const configured = env.QCE_BRIDGE_PORT;
  if (configured === undefined || configured === '') {
    return DEFAULT_BRIDGE_PORT;
  }
  const port = Number(configured);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid QCE_BRIDGE_PORT: ${configured}`);
  }
  return port;
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];
    child.stdout?.on('data', (chunk) => chunks.push(chunk));
    child.once('error', () => resolve({ stdout: '', exitCode: null }));
    child.once('close', (exitCode) => resolve({
      stdout: Buffer.concat(chunks).toString('utf8'),
      exitCode
    }));
  });
}

export function parseWindowsListeningPids(output, port) {
  const suffix = `:${port}`;
  const pids = new Set();
  for (const line of String(output).split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 5 || fields[0].toUpperCase() !== 'TCP') continue;
    if (!fields[1].endsWith(suffix) || fields[3].toUpperCase() !== 'LISTENING') continue;
    const pid = Number(fields[4]);
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) pids.add(pid);
  }
  return Array.from(pids);
}

async function listeningPids(port) {
  if (process.platform === 'win32') {
    const result = await runCommand('netstat', ['-ano', '-p', 'tcp']);
    return parseWindowsListeningPids(result.stdout, port);
  }
  const result = await runCommand('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
  return Array.from(new Set(
    result.stdout
      .split(/\r?\n/)
      .map((value) => Number(value.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
  ));
}

async function terminatePortOwners(port) {
  const pids = await listeningPids(port);
  const terminated = [];
  for (const pid of pids) {
    if (process.platform === 'win32') {
      const result = await runCommand('taskkill', ['/PID', String(pid), '/F', '/T']);
      if (result.exitCode === 0) terminated.push(pid);
    } else {
      try {
        process.kill(pid, 'SIGTERM');
        terminated.push(pid);
      } catch {
        continue;
      }
    }
  }
  return terminated;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, BRIDGE_HOST);
  });
}

export function bridgeJsonReplacer(_key, value) {
  if (value instanceof Map) {
    return Object.fromEntries(value);
  }
  if (value instanceof Set) {
    return Array.from(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

function runtimeDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}

function runtimeLogFile() {
  const pluginRoot = path.resolve(runtimeDir(), '..');
  const logDir = process.env.QCE_LOG_DIR
    ? path.resolve(process.env.QCE_LOG_DIR)
    : path.join(pluginRoot, 'logs');
  const logFile = process.env.QCE_LOG_FILE
    ? path.resolve(process.env.QCE_LOG_FILE)
    : path.join(logDir, 'qce-runtime.log');
  mkdirSync(path.dirname(logFile), { recursive: true });
  return logFile;
}

function appendRuntimeLog(logFile, prefix, message) {
  const text = String(message);
  try {
    appendFileSync(logFile, `[${new Date().toISOString()}] ${prefix} ${text}${text.endsWith('\n') ? '' : '\n'}`);
  } catch (error) {
    console.error(`[QCE] failed to write runtime log: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// --- one-click WebUI link ---------------------------------------------------
//
// Restores behaviour lost in the Rust rewrite. The old TypeScript ApiServer
// printed the access token and a ready-to-open `/qce/auth?token=…` link on
// startup (issue #287 — Framework mode has no embedded login entry point, so
// without it users had to dig the token out of security.json every time). The
// port to qce-server dropped both, and nothing replaced them on this launch
// path; the auth page's own help panel still tells users to look for them.
//
// Standalone mode re-added the link for its own, separate spawn path (issue
// #457, scripts/quick-pack.py's embedded qce-standalone.mjs). The wording is
// kept identical here by hand: the two cannot share code, because standalone
// mode is deliberately dependency-free and never loads this plugin runtime.

export function resolveSecurityConfigPath() {
  const override = (process.env.QCE_CONFIG_DIR || '').trim();
  const dir = override || path.join(os.homedir(), '.qq-chat-exporter');
  return path.join(dir, 'security.json');
}

export function buildAuthUrl(port, token) {
  return `http://127.0.0.1:${port}/qce/auth?token=${encodeURIComponent(token)}`;
}

export function buildBrowserOpenCommand(url, platform = process.platform) {
  if (platform === 'darwin') return { cmd: 'open', args: [url] };
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '', url] };
  return { cmd: 'xdg-open', args: [url] };
}

// qce-server writes security.json in SecurityManager::initialize(), which runs
// before it binds the port — so by the time waitForPort() resolves the file is
// already there and the first attempt normally succeeds. The retries only cover
// a slow/contended filesystem catching up, hence the much shorter budget than
// qce-standalone.mjs (which polls from before the server has even started).
export async function readAccessTokenWithRetry(configPath, { retries = 4, delayMs = 500 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const token = JSON.parse(readFileSync(configPath, 'utf8'))?.accessToken;
      if (typeof token === 'string' && token.length > 0) {
        return token;
      }
    } catch {
      // not readable yet — fall through to the retry delay below
    }
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}

// user-config.json is where the settings page's "自动打开浏览器" toggle
// (qce-v4-tool/components/ui/settings-panel.tsx) persists its choice, via
// PUT /api/config (qq-chat-export-server/src/api/routes/system.rs). That
// route resolves the file through PathManager::default_base_dir(), which —
// unlike resolveSecurityConfigPath() above — does NOT honor QCE_CONFIG_DIR.
// Matching that exactly here (rather than reusing resolveSecurityConfigPath)
// is required for the two to ever agree on which file they mean.
export function resolveUserConfigPath() {
  return path.join(os.homedir(), '.qq-chat-exporter', 'user-config.json');
}

export function readAutoOpenBrowserSetting(configPath) {
  try {
    const value = JSON.parse(readFileSync(configPath, 'utf8'))?.autoOpenBrowser;
    return typeof value === 'boolean' ? value : true;
  } catch {
    return true; // missing/unreadable config == the historical default (open)
  }
}

/**
 * QCE_NO_AUTO_OPEN=1 is a hard opt-out for headless boxes, documented and
 * tested independently of the persisted setting below — it always wins.
 * Otherwise this follows the settings-page toggle, re-read on every start so
 * a change made in the UI takes effect on the next launch without a rebuild.
 */
export function shouldAutoOpenBrowser(env = process.env, configPath = resolveUserConfigPath()) {
  if (env.QCE_NO_AUTO_OPEN === '1') return false;
  return readAutoOpenBrowserSetting(configPath);
}

function tryOpenBrowser(url) {
  if (!shouldAutoOpenBrowser()) return;
  try {
    const { cmd, args } = buildBrowserOpenCommand(url);
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {}); // best-effort: headless boxes have no browser to open
    child.unref();
  } catch {
    // best-effort only — the printed URL below is the real fallback
  }
}

async function announceWebUiReady(logFile, port) {
  const configPath = resolveSecurityConfigPath();
  const token = await readAccessTokenWithRetry(configPath);
  if (!token) {
    console.log(`[QCE] 未能读取访问令牌，请打开 ${configPath} 查看 accessToken 字段`);
    appendRuntimeLog(logFile, '[qce-plugin]', 'webui url announce: access token not found');
    return;
  }
  const url = buildAuthUrl(port, token);
  console.log('');
  // Both lines, in this order, are what the auth page's "找不到令牌？" panel
  // and docs/guide.md tell users to look for. The bare token is redundant with
  // the link on purpose: if the one-click page fails for any reason, it can
  // still be pasted into the token prompt by hand.
  console.log(`[QCE] Token: ${token}`);
  console.log(`[QCE] 一键登录: ${url}`);
  console.log('[QCE] 此链接包含访问令牌，请勿分享给他人');
  console.log('');
  appendRuntimeLog(logFile, '[qce-plugin]', 'webui url ready');
  tryOpenBrowser(url);
}

function executableName() {
  return process.platform === 'win32' ? 'qce-server.exe' : 'qce-server';
}

function platformDirectories() {
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  return [
    `${platform}-${process.arch}`,
    `${process.platform}-${process.arch}`
  ];
}

export function findRustServerBinary() {
  const name = executableName();
  const current = runtimeDir();
  const pluginRoot = path.resolve(current, '..');
  const roots = [
    current,
    pluginRoot,
    path.resolve(pluginRoot, '..'),
    path.resolve(pluginRoot, '..', '..'),
    path.resolve(pluginRoot, '..', '..', '..')
  ];

  const candidates = [];
  candidates.push(
    process.env.QCE_RUST_SERVER_PATH,
    process.env.QCE_SERVER_PATH,
    process.env.QCE_SERVER_BIN
  );
  for (const root of roots) {
    candidates.push(path.join(root, name));
    for (const platformDir of platformDirectories()) {
      candidates.push(path.join(root, 'bin', platformDir, name));
    }
  }

  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

export async function createNapCatBridge(core, port = resolveBridgePort(), recovery = {}) {
  const reclaimPort = recovery.reclaimPort ?? DEFAULT_BRIDGE_PORT;
  const terminateOwners = recovery.terminatePortOwners ?? terminatePortOwners;
  let requestId = 0;

  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') {
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.method !== 'POST' || request.url !== '/rpc') {
      response.writeHead(404).end();
      return;
    }

    const chunks = [];
    let total = 0;
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BRIDGE_BODY_BYTES) {
        request.destroy(new Error('bridge request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', async () => {
      const id = ++requestId;
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const { method, params = [] } = payload;
        const args = Array.isArray(params) ? params : [params];
        let result;
        if (method === 'Core.selfInfo') {
          result = core.selfInfo;
        } else if (method === 'MsgApi.getMsgsBySeqRange') {
          result = await core.context.session
            .getMsgService()
            .getMsgsBySeqRange(...args);
        } else if (
          String(method).startsWith('MsgService.') ||
          String(method).startsWith('GroupService.')
        ) {
          const [serviceName, functionName] = String(method).split('.', 2);
          const service = serviceName === 'MsgService'
            ? core.context.session.getMsgService()
            : core.context.session.getGroupService();
          const fn = service?.[functionName];
          if (typeof fn !== 'function') {
            throw new Error(`NapCatCore method not found: ${method}`);
          }
          result = await fn.apply(service, args);
        } else if (method === 'PacketApi.getGroupFileUrl') {
          result = await core.apis.PacketApi.pkt.operation.GetGroupFileUrl(
            String(args[0]),
            String(args[1])
          );
        } else {
          const separator = String(method).indexOf('.');
          if (separator <= 0) {
            throw new Error(`Invalid NapCatCore method: ${method}`);
          }
          const apiName = String(method).slice(0, separator);
          const functionName = String(method).slice(separator + 1);
          const api = core.apis?.[apiName];
          const fn = api?.[functionName];
          if (typeof fn !== 'function') {
            throw new Error(`NapCatCore method not found: ${method}`);
          }
          result = await fn.apply(api, args);
        }
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ id, ok: true, result }, bridgeJsonReplacer));
      } catch (error) {
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({
            id,
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          }));
      }
    });
    request.on('error', () => {
      if (!response.headersSent) {
        response.writeHead(400).end();
      }
    });
  });

  let terminatedPids = [];
  let fallbackFromPort = null;
  try {
    await listen(server, port);
  } catch (error) {
    if (error?.code !== 'EADDRINUSE' || port !== reclaimPort) throw error;
    terminatedPids = await terminateOwners(port);
    let reclaimed = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        await listen(server, port);
        reclaimed = true;
        break;
      } catch (retryError) {
        if (retryError?.code !== 'EADDRINUSE') throw retryError;
      }
    }
    if (!reclaimed) {
      fallbackFromPort = port;
      await listen(server, 0);
    }
  }

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise((resolve) => server.close(() => resolve()));
    throw new Error('NapCat bridge did not expose a TCP port');
  }

  return {
    port: address.port,
    terminatedPids,
    fallbackFromPort,
    stop: () => new Promise((resolve) => server.close(() => resolve()))
  };
}

async function waitForPort(child, port, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`qce-server exited before startup (code ${child.exitCode})`);
    }

    const ready = await new Promise((resolve) => {
      const socket = net.createConnection({ host: BRIDGE_HOST, port });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
      socket.setTimeout(500, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (ready) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`qce-server did not listen on port ${port} within ${timeoutMs}ms`);
}

export async function startRustApiServer(core, frontendPath) {
  const logFile = runtimeLogFile();
  appendRuntimeLog(logFile, '[qce-plugin]', 'starting qce-server');
  const binaryPath = findRustServerBinary();
  if (!binaryPath) {
    const error = new Error(
      `qce-server is required but was not found for ${process.platform}-${process.arch}`
    );
    appendRuntimeLog(logFile, '[qce-plugin]', `startup failed: ${error.message}`);
    throw error;
  }

  let bridge;
  try {
    bridge = await createNapCatBridge(core);
    if (bridge.terminatedPids.length > 0) {
      appendRuntimeLog(logFile, '[qce-plugin]', `terminated bridge port ${DEFAULT_BRIDGE_PORT} owner pid(s) ${bridge.terminatedPids.join(',')}`);
    }
    if (bridge.fallbackFromPort !== null) {
      appendRuntimeLog(logFile, '[qce-plugin]', `bridge port ${bridge.fallbackFromPort} remained busy; using ${bridge.port}`);
    }
    appendRuntimeLog(logFile, '[qce-plugin]', `bridge ready on port ${bridge.port}`);
  } catch (error) {
    appendRuntimeLog(logFile, '[qce-plugin]', `bridge startup failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    ...process.env,
    QCE_BRIDGE_ENDPOINT: `http://${BRIDGE_HOST}:${bridge.port}`,
    QCE_SERVER_PORT: String(API_PORT),
    QCE_LOG_DIR: path.dirname(logFile),
    QCE_LOG_FILE: logFile
  };
  if (frontendPath) {
    env.QCE_STATIC_DIR = frontendPath;
  }
  let child;
  try {
    child = spawn(binaryPath, [], {
      cwd: path.dirname(binaryPath),
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    appendRuntimeLog(logFile, '[qce-plugin]', `startup failed: ${error instanceof Error ? error.message : String(error)}`);
    await bridge.stop();
    throw error;
  }

  const stdioCaptured = process.env.QCE_STDIO_CAPTURED === '1';
  child.stdout?.on('data', (chunk) => {
    if (!stdioCaptured) {
      appendRuntimeLog(logFile, '[qce-server]', chunk);
    }
    core.context.logger.log(`[qce-server] ${String(chunk).trimEnd()}`);
  });
  child.stderr?.on('data', (chunk) => {
    if (!stdioCaptured) {
      appendRuntimeLog(logFile, '[qce-server]', chunk);
    }
    core.context.logger.logError(`[qce-server] ${String(chunk).trimEnd()}`);
  });
  child.on('error', (error) => {
    appendRuntimeLog(logFile, '[qce-plugin]', `process error: ${error.message}`);
  });
  child.on('exit', (code, signal) => {
    appendRuntimeLog(logFile, '[qce-plugin]', `qce-server exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
  });

  try {
    await Promise.race([
      waitForPort(child, API_PORT),
      new Promise((_, reject) => child.once('error', reject))
    ]);
    appendRuntimeLog(logFile, '[qce-plugin]', `qce-server ready on port ${API_PORT}`);
    announceWebUiReady(logFile, API_PORT).catch((error) => {
      appendRuntimeLog(logFile, '[qce-plugin]', `webui url announce failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  } catch (error) {
    appendRuntimeLog(logFile, '[qce-plugin]', `startup failed: ${error instanceof Error ? error.message : String(error)}`);
    child.kill();
    await bridge.stop();
    throw error;
  }

  return {
    async stop() {
      if (child.exitCode === null) {
        appendRuntimeLog(logFile, '[qce-plugin]', 'stopping qce-server');
        child.kill();
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 2_000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      await bridge.stop();
    }
  };
}
