import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRustApiServer } from './rustBridge.mjs';

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
  }

  async startApiServer() {
    if (this.isRunning) {
      return;
    }

    const frontendPath = resolveFrontendPath(this.core);
    this.server = await startRustApiServer(this.core, frontendPath);
    this.isRunning = true;

    const port = Number(process.env.QCE_SERVER_PORT || 40653);
    this.core.context.logger.log(
      '[QQChatExporter] API server started (Rust). ' +
      `Web UI: http://127.0.0.1:${port}/qce`
    );
  }

  async stopApiServer() {
    if (!this.server) {
      return;
    }

    await this.server.stop();
    this.server = null;
    this.isRunning = false;
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
