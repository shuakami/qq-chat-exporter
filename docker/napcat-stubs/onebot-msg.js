/**
 * OneBotMsgApi Stub — provides the interface expected by QCE plugin.
 * In the real NapCat runtime, the actual implementation is provided.
 * This stub allows the plugin to load without errors.
 */

export class OneBotMsgApi {
  constructor(context, core) {
    this.context = context;
    this.core = core;
  }

  async parseMessageV2(message, parseMultiForward, noResource, quickReply) {
    // Stub: return null to fall back to native parsing path
    return null;
  }
}

export default OneBotMsgApi;
