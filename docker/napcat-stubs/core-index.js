/**
 * NapCatCore Stub - provides the interface expected by QCE plugin.
 * In production, the real NapCatCore is provided by NapCat Shell.
 * This stub allows the plugin to load without requiring the full
 * NapCatQQ monorepo source.
 */

// Re-export types/enums that the plugin imports from this path
export { ChatType, RawMessage, MessageElement, ElementType, NTMsgType } from './types.js';

export class NapCatCore {
  constructor(rawCore) {
    this._rawCore = rawCore || null;

    // Logger
    this.context = {
      logger: (rawCore && rawCore.context && rawCore.context.logger) || {
        log: function() { console.log("[NapCatCore]", ...arguments); },
        logError: function() { console.error("[NapCatCore]", ...arguments); },
        logWarn: function() { console.warn("[NapCatCore]", ...arguments); },
        logDebug: function() { console.debug("[NapCatCore]", ...arguments); },
      },
      workingEnv: (rawCore && rawCore.context && rawCore.context.workingEnv) || 1, // 1 = shell
    };

    // APIs proxy — falls back to no-op stubs
    this._apis = (rawCore && rawCore.apis) || new Proxy({}, {
      get: function(target, prop) {
        return function() {
          console.log("[NapCatCore] API call:", prop);
          return Promise.resolve({ result: 0, errMsg: "" });
        };
      }
    });

    // OneBot context
    this._oneBotContext = (rawCore && typeof rawCore.getOneBotContext === "function")
      ? rawCore.getOneBotContext()
      : null;

    // Path wrapper
    var pw = (rawCore && rawCore.context && rawCore.context.pathWrapper) || {};
    this.pathWrapper = {
      pluginPath: pw.pluginPath || "/app/napcat/plugins",
      configPath: pw.configPath || "/app/napcat/config",
      cachePath: pw.cachePath || "/app/napcat/cache",
      staticPath: pw.staticPath || "/app/napcat/static",
      binaryPath: pw.binaryPath || "/app/napcat",
    };

    // QQ NT APIs storage
    this._ntApis = (rawCore && rawCore._ntApis) || {};
  }

  get apis() {
    return this._apis;
  }

  set apis(val) {
    this._apis = val;
  }

  getOneBotContext() {
    return this._oneBotContext;
  }

  setOneBotContext(ctx) {
    this._oneBotContext = ctx;
  }
}

// Peer class used by some plugin modules
export class Peer {
  constructor(data) {
    this.chatType = data?.chatType ?? 0;
    this.peerUid = data?.peerUid ?? '';
    this.guildId = data?.guildId ?? '';
  }
}

export default NapCatCore;
