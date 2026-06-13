/**
 * NapCatCore Stub - provides the interface expected by QCE plugin.
 * In production, the real NapCatCore is provided by NapCat Shell.
 * This stub allows the plugin to load without requiring the full
 * NapCatQQ monorepo source.
 */

// Re-export types/enums that the plugin imports from this path
export { ChatType, RawMessage, MessageElement, ElementType, NTMsgType } from './types.js';

/**
 * Create a nested API proxy that returns objects with methods, not functions.
 * This matches the real NapCat API structure where apis.GroupApi is an object
 * with methods like getGroups(), fetchGroupDetail(), etc.
 */
function createApiProxy() {
  return new Proxy({}, {
    get: function(target, prop) {
      // Return a proxy for each API namespace (GroupApi, FriendApi, etc.)
      if (!(prop in target)) {
        target[prop] = new Proxy({}, {
          get: function(apiTarget, method) {
            return async function(...args) {
              console.log("[NapCatCore] API call:", `${String(prop)}.${String(method)}`);
              // Return appropriate defaults based on method name
              if (method === 'getGroups' || method === 'getFriends' || method === 'getBuddy') {
                return [];
              }
              if (method === 'getGroupMemberAll') {
                return { result: { infos: new Map() } };
              }
              if (method === 'fetchGroupDetail') {
                return { groupCode: args[0], groupName: 'Unknown' };
              }
              return { result: 0, errMsg: "" };
            };
          }
        });
      }
      return target[prop];
    }
  });
}

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
    this._apis = (rawCore && rawCore.apis) || createApiProxy();

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
