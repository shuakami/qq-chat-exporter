/**
 * 创建Overlay运行时代理文件
 * 这些文件是手动维护的模板，不从NapCat源代码生成
 */

const fs = require('fs');
const path = require('path');

const OVERLAY_DIR = path.resolve(__dirname, '../node_modules/NapCatQQ');

const FILES = {
  'package.json': JSON.stringify({
    "name": "NapCatQQ",
    "version": "0.0.0-overlay",
    "private": true,
    "type": "module",
    "exports": { "./src/*": "./src/*" },
    "typesVersions": { "*": { "src/*": ["types/*"] } }
  }, null, 2),

  'src/core/apis/msg.js': `function getBridge() {
  const bridge = globalThis.__NAPCAT_BRIDGE__;
  if (!bridge) throw new Error('[QCE Overlay] Bridge未初始化');
  return bridge;
}

export const MsgApi = {
  async getMsgHistory(peer, msgId, count, reverse) {
    const { core } = getBridge();
    const impl = core?.apis?.MsgApi?.getMsgHistory || core?.apis?.msg?.getMsgHistory;
    if (!impl) throw new Error('[QCE Overlay] MsgApi.getMsgHistory 不可用');
    return impl.call(core.apis.MsgApi || core.apis.msg, peer, msgId, count, reverse);
  },

  async getAioFirstViewLatestMsgs(peer, count) {
    const { core } = getBridge();
    const impl = core?.apis?.MsgApi?.getAioFirstViewLatestMsgs || core?.apis?.msg?.getAioFirstViewLatestMsgs;
    if (!impl) throw new Error('[QCE Overlay] MsgApi.getAioFirstViewLatestMsgs 不可用');
    return impl.call(core.apis.MsgApi || core.apis.msg, peer, count);
  },

  async getMultiMsg(params) {
    const { core } = getBridge();
    const impl = core?.apis?.MsgApi?.getMultiMsg || core?.apis?.msg?.getMultiMsg;
    if (impl) return impl.call(core.apis.MsgApi || core.apis.msg, params);
    
    const { actions, instance } = getBridge();
    const handler = actions?.get?.('get_forward_msg');
    if (!handler) throw new Error('[QCE Overlay] get_forward_msg 不可用');
    const result = await handler.handle({ id: params.forwardId || params.resId }, 'plugin', instance?.config);
    return result?.data;
  }
};

export const NTQQMsgApi = MsgApi;
export default MsgApi;
`,

  'src/core/apis/file.js': `function getBridge() {
  const bridge = globalThis.__NAPCAT_BRIDGE__;
  if (!bridge) throw new Error('[QCE Overlay] Bridge未初始化');
  return bridge;
}

export const FileApi = {
  async downloadMedia(msgId, chatType, peerUid, elementId, thumbPath, sourcePath, timeout, force) {
    const { core } = getBridge();
    const impl = core?.apis?.FileApi?.downloadMedia || core?.apis?.file?.downloadMedia;
    if (!impl) throw new Error('[QCE Overlay] FileApi.downloadMedia 不可用');
    return impl.call(core.apis.FileApi || core.apis.file, msgId, chatType, peerUid, elementId, thumbPath, sourcePath, timeout, force);
  }
};

export const NTQQFileApi = FileApi;
export default FileApi;
`,

  'src/core/apis/group.js': `function getBridge() {
  const bridge = globalThis.__NAPCAT_BRIDGE__;
  if (!bridge) throw new Error('[QCE Overlay] Bridge未初始化');
  return bridge;
}

export const GroupApi = {
  async getGroups(forceRefresh = false) {
    const { core } = getBridge();
    const impl = core?.apis?.GroupApi?.getGroups || core?.apis?.group?.getGroups;
    if (!impl) throw new Error('[QCE Overlay] GroupApi.getGroups 不可用');
    return impl.call(core.apis.GroupApi || core.apis.group, forceRefresh);
  },

  async fetchGroupDetail(groupId) {
    const { core } = getBridge();
    const impl = core?.apis?.GroupApi?.fetchGroupDetail || core?.apis?.group?.fetchGroupDetail;
    if (impl) return impl.call(core.apis.GroupApi || core.apis.group, String(groupId));
    
    const { actions, instance } = getBridge();
    const handler = actions?.get?.('get_group_info');
    if (!handler) throw new Error('[QCE Overlay] get_group_info 不可用');
    const result = await handler.handle({ group_id: Number(groupId) }, 'plugin', instance?.config);
    return result?.data;
  },

  async getGroupMemberAll(groupId, forceRefresh = false) {
    const { core } = getBridge();
    const impl = core?.apis?.GroupApi?.getGroupMemberAll || core?.apis?.group?.getGroupMemberAll;
    if (impl) return impl.call(core.apis.GroupApi || core.apis.group, String(groupId), forceRefresh);
    
    const { actions, instance } = getBridge();
    const handler = actions?.get?.('get_group_member_list');
    if (!handler) throw new Error('[QCE Overlay] get_group_member_list 不可用');
    const result = await handler.handle({ group_id: Number(groupId) }, 'plugin', instance?.config);
    return { result: { infos: new Map(result?.data?.map(m => [m.user_id, m]) || []) } };
  }
};

export const NTQQGroupApi = GroupApi;
export default GroupApi;
`,

  'src/core/apis/user.js': `function getBridge() {
  const bridge = globalThis.__NAPCAT_BRIDGE__;
  if (!bridge) throw new Error('[QCE Overlay] Bridge未初始化');
  return bridge;
}

export const UserApi = {
  async getUserDetailInfo(uid, noCache = false) {
    const { core } = getBridge();
    const impl = core?.apis?.UserApi?.getUserDetailInfo || core?.apis?.user?.getUserDetailInfo;
    if (impl) return impl.call(core.apis.UserApi || core.apis.user, uid, noCache);
    
    const { actions, instance } = getBridge();
    const handler = actions?.get?.('get_stranger_info');
    if (!handler) throw new Error('[QCE Overlay] get_stranger_info 不可用');
    const result = await handler.handle({ user_id: Number(uid) }, 'plugin', instance?.config);
    return result?.data;
  },

  async getRecentContactListSnapShot(count = 100) {
    const { core } = getBridge();
    const impl = core?.apis?.UserApi?.getRecentContactListSnapShot || core?.apis?.user?.getRecentContactListSnapShot;
    if (!impl) throw new Error('[QCE Overlay] UserApi.getRecentContactListSnapShot 不可用');
    return impl.call(core.apis.UserApi || core.apis.user, count);
  }
};

export const NTQQUserApi = UserApi;
export default UserApi;
`,

  'src/core/apis/friend.js': `function getBridge() {
  const bridge = globalThis.__NAPCAT_BRIDGE__;
  if (!bridge) throw new Error('[QCE Overlay] Bridge未初始化');
  return bridge;
}

export const FriendApi = {
  async getBuddy(forceRefresh = false) {
    const { core } = getBridge();
    const impl = core?.apis?.FriendApi?.getBuddy || core?.apis?.friend?.getBuddy;
    if (!impl) throw new Error('[QCE Overlay] FriendApi.getBuddy 不可用');
    return impl.call(core.apis.FriendApi || core.apis.friend, forceRefresh);
  }
};

export const NTQQFriendApi = FriendApi;
export default FriendApi;
`,

  'src/core/index.js': `function getBridge() {
  const bridge = globalThis.__NAPCAT_BRIDGE__;
  if (!bridge) throw new Error('[QCE Overlay] Bridge未初始化');
  return bridge;
}

import { MsgApi } from './apis/msg.js';
import { FileApi } from './apis/file.js';
import { GroupApi } from './apis/group.js';
import { UserApi } from './apis/user.js';
import { FriendApi } from './apis/friend.js';

export class NapCatCore {
  constructor() {
    const { core } = getBridge();
    if (!core) throw new Error('[QCE Overlay] NapCatCore实例不可用');
    
    this.apis = { MsgApi, FileApi, GroupApi, UserApi, FriendApi };
    this.context = {
      logger: {
        log: (...args) => core.context?.logger?.log?.(...args) || console.log('[QCE]', ...args),
        logError: (...args) => core.context?.logger?.logError?.(...args) || console.error('[QCE]', ...args),
        logWarn: (...args) => core.context?.logger?.logWarn?.(...args) || console.warn('[QCE]', ...args),
        logDebug: (...args) => core.context?.logger?.logDebug?.(...args) || console.debug('[QCE]', ...args)
      },
      session: core.context?.session
    };
    
    Object.defineProperty(this, 'selfInfo', { get() { return core.selfInfo; } });
  }
}

export { ChatType, ElementType, NTMsgType, RawMessage, MessageElement } from './types.js';

export class Peer {
  constructor(chatType, peerUid, guildId = '') {
    this.chatType = chatType;
    this.peerUid = peerUid;
    this.guildId = guildId;
  }
}

export default NapCatCore;
`,

  'src/core/types.js': `export const ChatType = {
  Friend: 1,
  Group: 2,
  Temp: 100,
  Guild: 4
};

export const ElementType = {
  Text: 1,
  Picture: 2,
  File: 3,
  Video: 4,
  Reply: 7,
  Ptt: 4,
  Face: 6,
  Mface: 37,
  Ark: 10,
  Markdown: 51
};

export const NTMsgType = {
  Text: 1,
  Picture: 2,
  File: 3,
  Video: 4,
  Voice: 5,
  Reply: 7
};

export class RawMessage {
  constructor(data = {}) {
    Object.assign(this, data);
  }
}

export class MessageElement {
  constructor(data = {}) {
    Object.assign(this, data);
  }
}

export default { ChatType, ElementType, NTMsgType, RawMessage, MessageElement };
`,

  'src/onebot/api/msg.js': `function getBridge() {
  const bridge = globalThis.__NAPCAT_BRIDGE__;
  if (!bridge) throw new Error('[QCE Overlay] Bridge未初始化');
  return bridge;
}

export class OneBotMsgApi {
  constructor(obContext, core) {
    this.obContext = obContext;
    this.core = core;
  }

  async parseMessage(message, quickReply = false) {
    return this.parseMessageV2(message, true, false, quickReply);
  }

  async parseMessageV2(message, parseMultiForward = true, rawMessage = false, quickReply = false) {
    const { core } = getBridge();
    if (core?.onebot?.msgApi?.parseMessageV2) {
      return core.onebot.msgApi.parseMessageV2(message, parseMultiForward, rawMessage, quickReply);
    }
    
    return {
      arrayMsg: {
        message_id: message.msgId,
        message_seq: message.msgSeq,
        time: parseInt(message.msgTime),
        sender: { user_id: message.senderUin, nickname: message.sendNickName },
        message: [],
        raw_message: '',
        message_type: message.chatType === 2 ? 'group' : 'private'
      }
    };
  }
}

export default OneBotMsgApi;
`
};

console.log('创建Overlay运行时代理文件...\n');

for (const [relPath, content] of Object.entries(FILES)) {
  const fullPath = path.join(OVERLAY_DIR, relPath);
  const dir = path.dirname(fullPath);
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(`✓ ${relPath}`);
}

console.log('\n✅ 所有运行时代理文件已创建');

