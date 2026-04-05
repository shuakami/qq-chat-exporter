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

function normalizeGroup(group) {
  const code = group?.groupCode ?? group?.group_code ?? group?.group_id ?? group?.groupId ?? group?.groupUin ?? '';
  const name = group?.groupName ?? group?.group_name ?? group?.groupRemark ?? group?.name ?? String(code || 'unknown');
  const memberCount = group?.memberCount ?? group?.member_count ?? group?.memberNum ?? 0;
  const maxMember = group?.maxMember ?? group?.max_member ?? group?.maxMemberCount ?? 0;

  return {
    ...group,
    groupCode: String(code),
    groupName: String(name),
    memberCount: Number(memberCount) || 0,
    maxMember: Number(maxMember) || 0
  };
}

async function callAction(actionName, payload) {
  const { actions, instance } = getBridge();
  const handler = actions?.get?.(actionName);
  if (!handler) return null;
  const result = await handler.handle(payload, 'plugin', instance?.config);
  return result?.data ?? result ?? null;
}

export const GroupApi = {
  async getGroups(forceRefresh = false) {
    const { core } = getBridge();
    const contexts = [core?.apis?.GroupApi, core?.apis?.group].filter(Boolean);
    const methodNames = ['getGroups', 'getGroupList', 'getGroupLists'];

    for (const ctx of contexts) {
      for (const methodName of methodNames) {
        const impl = ctx?.[methodName];
        if (typeof impl !== 'function') continue;
        const result = await impl.call(ctx, forceRefresh);
        if (Array.isArray(result)) return result.map(normalizeGroup);
        if (Array.isArray(result?.data)) return result.data.map(normalizeGroup);
        if (Array.isArray(result?.result?.groupList)) return result.result.groupList.map(normalizeGroup);
      }
    }

    const actionResult = await callAction('get_group_list', {});
    if (Array.isArray(actionResult)) return actionResult.map(normalizeGroup);

    throw new Error('[QCE Overlay] GroupApi.getGroups 不可用');
  },

  async fetchGroupDetail(groupId) {
    const { core } = getBridge();
    const impl = core?.apis?.GroupApi?.fetchGroupDetail || core?.apis?.group?.fetchGroupDetail;
    if (impl) {
      const detail = await impl.call(core.apis.GroupApi || core.apis.group, String(groupId));
      return detail ? normalizeGroup(detail) : detail;
    }

    const actionResult = await callAction('get_group_info', { group_id: Number(groupId) });
    return actionResult ? normalizeGroup(actionResult) : actionResult;
  },

  async getGroupMemberAll(groupId, forceRefresh = false) {
    const { core } = getBridge();
    const impl = core?.apis?.GroupApi?.getGroupMemberAll || core?.apis?.group?.getGroupMemberAll;
    if (impl) return impl.call(core.apis.GroupApi || core.apis.group, String(groupId), forceRefresh);

    const { actions, instance } = getBridge();
    const handler = actions?.get?.('get_group_member_list');
    if (!handler) throw new Error('[QCE Overlay] get_group_member_list 不可用');

    const result = await handler.handle({ group_id: Number(groupId) }, 'plugin', instance?.config);
    const members = result?.data ?? result ?? null;
    if (!Array.isArray(members)) {
      throw new Error('[QCE Overlay] get_group_member_list 返回异常');
    }

    return { result: { infos: new Map(members.map(m => [m.user_id, m])) } };
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

  async getUidByUinV2(uin) {
    const { core } = getBridge();
    const impl = core?.apis?.UserApi?.getUidByUinV2 || core?.apis?.user?.getUidByUinV2;
    if (!impl) throw new Error('[QCE Overlay] UserApi.getUidByUinV2 不可用');
    return impl.call(core.apis.UserApi || core.apis.user, uin);
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

function normalizeFriend(friend, categoryId = 1) {
  const uin = String(
    friend?.uin ??
    friend?.user_id ??
    friend?.qq ??
    friend?.coreInfo?.uin ??
    ''
  );
  const uid = String(
    friend?.uid ??
    friend?.coreInfo?.uid ??
    friend?.user_uid ??
    uin
  );
  const nick =
    friend?.coreInfo?.nick ??
    friend?.nickname ??
    friend?.nick ??
    uin;
  const remark =
    friend?.coreInfo?.remark ??
    friend?.remark ??
    null;

  return {
    ...friend,
    uid,
    uin,
    coreInfo: {
      ...(friend?.coreInfo || {}),
      uid,
      uin,
      nick,
      remark
    },
    baseInfo: {
      ...(friend?.baseInfo || {}),
      categoryId: friend?.baseInfo?.categoryId ?? friend?.categoryId ?? categoryId
    },
    status: friend?.status || { status: 0 }
  };
}

function normalizeCategory(category, index = 0) {
  const categoryId = category?.categoryId ?? category?.id ?? category?.category_id ?? (index + 1);
  const buddyList = Array.isArray(category?.buddyList)
    ? category.buddyList
    : Array.isArray(category?.friends)
      ? category.friends
      : [];

  return {
    ...category,
    categoryId,
    buddyList: buddyList.map(friend => normalizeFriend(friend, categoryId))
  };
}

function flattenToCategory(friends) {
  return [normalizeCategory({ categoryId: 1, buddyList: friends || [] }, 0)];
}

async function callAction(actionName, payload) {
  const { actions, instance } = getBridge();
  const handler = actions?.get?.(actionName);
  if (!handler) return null;
  const result = await handler.handle(payload, 'plugin', instance?.config);
  return result?.data ?? result ?? null;
}

export const FriendApi = {
  async getBuddyV2ExWithCate(forceRefresh = false) {
    const { core } = getBridge();
    const contexts = [core?.apis?.FriendApi, core?.apis?.friend].filter(Boolean);
    const methodNames = ['getBuddyV2ExWithCate', 'getBuddyV2ExWithCategory'];

    for (const ctx of contexts) {
      for (const methodName of methodNames) {
        const impl = ctx?.[methodName];
        if (typeof impl !== 'function') continue;
        const result = await impl.call(ctx, forceRefresh);
        if (Array.isArray(result)) return result.map(normalizeCategory);
        if (Array.isArray(result?.data)) return result.data.map(normalizeCategory);
      }
    }

    for (const ctx of contexts) {
      const impl = ctx?.getBuddy || ctx?.getFriends;
      if (typeof impl !== 'function') continue;
      const result = await impl.call(ctx, forceRefresh);
      if (Array.isArray(result)) return flattenToCategory(result.map(friend => normalizeFriend(friend)));
      if (Array.isArray(result?.data)) return flattenToCategory(result.data.map(friend => normalizeFriend(friend)));
    }

    const actionResult = await callAction('get_friend_list', {});
    if (Array.isArray(actionResult)) return flattenToCategory(actionResult.map(friend => normalizeFriend(friend)));

    throw new Error('[QCE Overlay] FriendApi.getBuddyV2ExWithCate 不可用');
  },

  async getBuddy(forceRefresh = false) {
    const categories = await this.getBuddyV2ExWithCate(forceRefresh);
    return categories.flatMap(cat => cat?.buddyList || []);
  },

  async getFriends(forceRefresh = false) {
    return this.getBuddy(forceRefresh);
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

    const coreApis = core.apis && typeof core.apis === 'object' ? core.apis : {};
    const coreContext = core.context && typeof core.context === 'object' ? core.context : {};

    this.apis = {
      ...coreApis,
      MsgApi,
      FileApi,
      GroupApi,
      UserApi,
      FriendApi
    };
    this.context = {
      ...coreContext,
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
  TEXT: 1,
  PIC: 2,
  FILE: 3,
  VIDEO: 4,
  PTT: 4,
  FACE: 6,
  REPLY: 7,
  ARK: 10,
  MFACE: 37,
  MARKDOWN: 51,
  GreyTip: 8,
  SHARELOCATION: 20,
  CALENDAR: 21,
  MULTIFORWARD: 16
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

