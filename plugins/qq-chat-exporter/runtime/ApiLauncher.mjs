import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRustApiServer } from './rustBridge.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function resolveFrontendPath(core) {
  const candidates = [
    process.env.QCE_STATIC_DIR,
    path.join(pluginRoot, 'webui'),
    path.resolve(pluginRoot, '..', '..', 'static', 'qce'),
    typeof core.configPath === 'string'
      ? path.join(core.configPath, 'static', 'qce')
      : undefined,
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
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
