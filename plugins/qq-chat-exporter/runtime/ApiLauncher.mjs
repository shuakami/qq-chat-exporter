import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRustApiServer, StartupCleanupError } from './rustBridge.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function resolveFrontendPath(core, options = {}) {
  const env = options.env ?? process.env;
  const root = options.pluginRoot ?? pluginRoot;
  const candidates = [
    env.QCE_STATIC_DIR,
    path.resolve(root, '..', '..', 'static', 'qce'),
    typeof core?.configPath === 'string'
      ? path.join(core.configPath, 'static', 'qce')
      : undefined,
    path.join(root, 'webui'),
  ];
  return candidates.find((candidate) =>
    candidate && fs.existsSync(path.join(candidate, 'index.html'))
  );
}

export class QQChatExporterApiLauncher {
  constructor(core) {
    this.core = core;
    this.server = null;
    this.isRunning = false;
    this.run = null;
  }

  /** @param {{ signal?: AbortSignal }} [options] */
  startApiServer({ signal } = {}) {
    if (this.run && !this.run.stopped) return this.run.startPromise;
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const run = { controller, startPromise: null, stopPromise: null, server: null, stopped: false };
    this.run = run;
    run.startPromise = Promise.resolve().then(async () => {
      controller.signal.throwIfAborted();
      const frontendPath = resolveFrontendPath(this.core);
      run.server = await startRustApiServer(this.core, frontendPath, { signal: controller.signal });
      this.server = run.server;
      this.isRunning = true;
      const port = Number(process.env.QCE_SERVER_PORT || 40653);
      try {
        this.core.context.logger.log(
          '[QQChatExporter] API server started (Rust). ' +
          `Web UI: http://127.0.0.1:${port}/qce`
        );
      } catch (error) {
        // The host logger is outside the Rust startup boundary. A failure
        // here must still release the server before initialization rejects.
        try { await run.server.stop(); } catch (cleanupError) {
          throw new StartupCleanupError(error, cleanupError);
        }
        run.server = null;
        this.server = null;
        this.isRunning = false;
        throw error;
      }
    }).finally(() => signal?.removeEventListener('abort', abort));
    return run.startPromise;
  }

  stopApiServer() {
    const run = this.run;
    if (!run) return Promise.resolve();
    if (!run.stopPromise) {
      run.stopPromise = Promise.resolve().then(async () => {
        run.controller.abort();
        let startError;
        let startFailed = false;
        try { await run.startPromise; } catch (error) { startFailed = true; startError = error; }
        if (startError instanceof StartupCleanupError) throw startError;
        try { await run.server?.stop(); } catch (stopError) {
          if (startFailed) throw new AggregateError([startError, stopError], 'API startup and cleanup failed');
          throw stopError;
        }
        // Ordinary startup failures are already reported to the start caller
        // after cleanup. Only unconfirmed cleanup must prevent host shutdown.
        run.stopped = true;
        if (this.run === run) {
          this.server = null;
          this.isRunning = false;
        }
      });
    }
    return run.stopPromise;
  }

  getStatus() {
    const port = Number(process.env.QCE_SERVER_PORT || 40653);
    return {
      isRunning: this.isRunning,
      port: this.isRunning ? port : undefined,
      address: this.isRunning ? `http://127.0.0.1:${port}` : undefined
    };
  }
}
