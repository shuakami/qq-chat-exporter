import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BRIDGE_BODY_BYTES = 64 * 1024 * 1024;
const BRIDGE_HOST = '127.0.0.1';
const BRIDGE_PORT = Number(process.env.QCE_BRIDGE_PORT || 40654);
const API_PORT = Number(process.env.QCE_SERVER_PORT || 40653);

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

export async function createNapCatBridge(core, port = BRIDGE_PORT) {
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

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, BRIDGE_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });

  return {
    port,
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
