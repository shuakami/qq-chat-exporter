/**
 * NapCat Overlay生成器
 * 自动从NapCat源代码生成类型定义和枚举
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const cp = require('child_process');

// 配置
const OVERLAY_DIR = path.resolve(__dirname, '../node_modules/NapCatQQ');
const TMP_DIR = path.resolve(__dirname, '../.napcat-src');
const NAPCAT_GIT = process.env.NAPCAT_GIT || 'https://github.com/NapNeko/NapCatQQ.git';
const NAPCAT_REF = process.env.NAPCAT_REF || 'v4.8.119';

// 工具函数
async function run(cmd, cwd) {
  return new Promise((resolve, reject) => {
    console.log(`[exec] ${cmd} (cwd: ${cwd})`);
    cp.exec(cmd, { cwd }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[exec error] ${stderr}`);
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// 克隆或更新NapCat源代码
async function cloneNapCat() {
  console.log(`[clone] 准备克隆NapCat ${NAPCAT_REF}...`);
  
  if (fs.existsSync(TMP_DIR)) {
    console.log(`[clone] 临时目录已存在，尝试更新...`);
    try {
      await run('git fetch --all', TMP_DIR);
      await run(`git checkout ${NAPCAT_REF}`, TMP_DIR);
      await run(`git reset --hard origin/${NAPCAT_REF}`, TMP_DIR);
    } catch (e) {
      console.warn(`[clone] 更新失败，删除并重新克隆: ${e.message}`);
      await fsp.rm(TMP_DIR, { recursive: true, force: true });
    }
  }
  
  if (!fs.existsSync(TMP_DIR)) {
    console.log(`[clone] 克隆仓库...`);
    const parentDir = path.dirname(TMP_DIR);
    await run(`git clone --depth 1 --branch ${NAPCAT_REF} ${NAPCAT_GIT} ${path.basename(TMP_DIR)}`, parentDir);
  }
  
  // 获取commit信息
  const { stdout } = await run('git rev-parse HEAD', TMP_DIR);
  const commit = stdout.trim();
  console.log(`[clone] 使用commit: ${commit}`);
  
  await fsp.writeFile(path.join(OVERLAY_DIR, 'NAPCAT_COMMIT'), `${commit}\n`);
  return commit;
}

// 从源代码中提取枚举
function extractEnumsFromSource(napcatRoot) {
  console.log(`[enum] 开始提取枚举...`);
  
  const enums = {
    ChatType: {},
    ElementType: {},
    NTMsgType: {}
  };
  
  const srcDir = path.join(napcatRoot, 'src');
  
  function scanFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // 匹配枚举定义
    const enumRegex = /export\s+(?:const\s+)?enum\s+(ChatType|ElementType|NTMsgType)\s*\{([^}]+)\}/g;
    let match;
    
    while ((match = enumRegex.exec(content)) !== null) {
      const enumName = match[1];
      const enumBody = match[2];
      
      // 解析枚举成员
      const memberRegex = /([A-Za-z0-9_]+)\s*=\s*([0-9]+)/g;
      let memberMatch;
      
      while ((memberMatch = memberRegex.exec(enumBody)) !== null) {
        const key = memberMatch[1];
        const value = parseInt(memberMatch[2]);
        enums[enumName][key] = value;
        console.log(`[enum] ${enumName}.${key} = ${value}`);
      }
    }
  }
  
  function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile() && /\.(ts|tsx|mts)$/.test(entry.name)) {
        try {
          scanFile(fullPath);
        } catch (error) {
          // 忽略无法读取的文件
        }
      }
    }
  }
  
  walkDir(srcDir);
  
  console.log(`[enum] 提取完成:`);
  console.log(`  - ChatType: ${Object.keys(enums.ChatType).length} 项`);
  console.log(`  - ElementType: ${Object.keys(enums.ElementType).length} 项`);
  console.log(`  - NTMsgType: ${Object.keys(enums.NTMsgType).length} 项`);
  
  return enums;
}

// 写入枚举到types.js
async function writeEnums(enums, commit) {
  console.log(`[write] 写入枚举到types.js...`);
  
  const typesJsPath = path.join(OVERLAY_DIR, 'src/core/types.js');
  
  const content = `/**
 * 核心类型和枚举（运行时）
 * 自动生成自 NapCat commit: ${commit}
 */

// 聊天类型枚举
export const ChatType = Object.freeze(${JSON.stringify(enums.ChatType, null, 2)});

// 元素类型枚举
export const ElementType = Object.freeze(${JSON.stringify(enums.ElementType, null, 2)});

// 消息类型枚举
export const NTMsgType = Object.freeze(${JSON.stringify(enums.NTMsgType, null, 2)});

// 原始消息类型（占位）
export class RawMessage {
  constructor() {
    this.msgId = '';
    this.msgSeq = '';
    this.msgRandom = '';
    this.msgTime = '';
    this.chatType = 0;
    this.msgType = 0;
    this.senderUid = '';
    this.senderUin = '';
    this.peerUid = '';
    this.sendNickName = '';
    this.sendRemarkName = '';
    this.elements = [];
    this.recallTime = '0';
  }
}

// 消息元素类型（占位）
export class MessageElement {
  constructor() {
    this.elementId = '';
    this.elementType = 0;
    this.textElement = null;
    this.picElement = null;
    this.videoElement = null;
    this.fileElement = null;
    this.pttElement = null;
    this.faceElement = null;
    this.marketFaceElement = null;
    this.replyElement = null;
    this.arkElement = null;
    this.markdownElement = null;
    this.multiForwardMsgElement = null;
    this.grayTipElement = null;
    this.shareLocationElement = null;
    this.calendarElement = null;
  }
}

export default {
  ChatType,
  ElementType,
  NTMsgType,
  RawMessage,
  MessageElement
};
`;
  
  await fsp.writeFile(typesJsPath, content);
  console.log(`[write] 已写入 ${typesJsPath}`);
}

// 生成TypeScript类型定义
async function generateTypeDefinitions(enums) {
  console.log(`[types] 生成TypeScript类型定义...`);
  
  const typesDir = path.join(OVERLAY_DIR, 'types/core');
  await fsp.mkdir(typesDir, { recursive: true });
  
  // 生成core/types.d.ts
  const typesDts = `/**
 * 核心类型定义
 */

export declare const ChatType: {
${Object.entries(enums.ChatType).map(([k, v]) => `  readonly ${k}: ${v};`).join('\n')}
};

export declare const ElementType: {
${Object.entries(enums.ElementType).map(([k, v]) => `  readonly ${k}: ${v};`).join('\n')}
};

export declare const NTMsgType: {
${Object.entries(enums.NTMsgType).map(([k, v]) => `  readonly ${k}: ${v};`).join('\n')}
};

export interface RawMessage {
  msgId: string;
  msgSeq: string;
  msgRandom?: string;
  msgTime: string;
  chatType: number;
  msgType: number;
  senderUid: string;
  senderUin?: string;
  peerUid: string;
  sendNickName?: string;
  sendRemarkName?: string;
  elements: MessageElement[];
  recallTime?: string;
}

export interface MessageElement {
  elementId: string;
  elementType: number;
  textElement?: any;
  picElement?: any;
  videoElement?: any;
  fileElement?: any;
  pttElement?: any;
  faceElement?: any;
  marketFaceElement?: any;
  replyElement?: any;
  arkElement?: any;
  markdownElement?: any;
  multiForwardMsgElement?: any;
  grayTipElement?: any;
  shareLocationElement?: any;
  calendarElement?: any;
}

export interface Peer {
  chatType: number;
  peerUid: string;
  guildId?: string;
}
`;
  
  await fsp.writeFile(path.join(typesDir, 'types.d.ts'), typesDts);
  console.log(`[types] 已生成 core/types.d.ts`);
  
  // 生成core/index.d.ts
  const indexDts = `/**
 * NapCatCore类型定义
 */

import { MsgApi } from './apis/msg.js';
import { FileApi } from './apis/file.js';
import { GroupApi } from './apis/group.js';
import { UserApi } from './apis/user.js';
import { FriendApi } from './apis/friend.js';

export * from './types.js';

export declare class NapCatCore {
  apis: {
    MsgApi: typeof MsgApi;
    FileApi: typeof FileApi;
    GroupApi: typeof GroupApi;
    UserApi: typeof UserApi;
    FriendApi: typeof FriendApi;
  };
  
  context: {
    logger: {
      log(...args: any[]): void;
      logError(...args: any[]): void;
      logWarn(...args: any[]): void;
      logDebug(...args: any[]): void;
    };
    session: any;
  };
  
  selfInfo: any;
}

export default NapCatCore;
`;
  
  await fsp.writeFile(path.join(typesDir, 'index.d.ts'), indexDts);
  console.log(`[types] 已生成 core/index.d.ts`);
  
  // 生成API类型定义
  await generateApiTypes(typesDir);
}

// 生成API类型定义
async function generateApiTypes(typesDir) {
  const apisDir = path.join(typesDir, 'apis');
  await fsp.mkdir(apisDir, { recursive: true });
  
  // msg.d.ts
  const msgDts = `import { Peer, RawMessage } from '../types.js';

export declare const MsgApi: {
  getMsgHistory(peer: Peer, msgId: string, count: number, reverse: boolean): Promise<any>;
  getAioFirstViewLatestMsgs(peer: Peer, count: number): Promise<any>;
  getMultiMsg(params: { forwardId?: string; resId?: string }): Promise<any>;
};

export declare const NTQQMsgApi: typeof MsgApi;
export default MsgApi;
`;
  await fsp.writeFile(path.join(apisDir, 'msg.d.ts'), msgDts);
  
  // file.d.ts
  const fileDts = `export declare const FileApi: {
  downloadMedia(
    msgId: string,
    chatType: number,
    peerUid: string,
    elementId: string,
    thumbPath: string,
    sourcePath: string,
    timeout: number,
    force: boolean
  ): Promise<string>;
};

export declare const NTQQFileApi: typeof FileApi;
export default FileApi;
`;
  await fsp.writeFile(path.join(apisDir, 'file.d.ts'), fileDts);
  
  // group.d.ts
  const groupDts = `export declare const GroupApi: {
  getGroups(forceRefresh?: boolean): Promise<any[]>;
  fetchGroupDetail(groupId: string | number): Promise<any>;
  getGroupMemberAll(groupId: string | number, forceRefresh?: boolean): Promise<any>;
};

export declare const NTQQGroupApi: typeof GroupApi;
export default GroupApi;
`;
  await fsp.writeFile(path.join(apisDir, 'group.d.ts'), groupDts);
  
  // user.d.ts
  const userDts = `export declare const UserApi: {
  getUserDetailInfo(uid: string | number, noCache?: boolean): Promise<any>;
  getRecentContactListSnapShot(count?: number): Promise<any>;
};

export declare const NTQQUserApi: typeof UserApi;
export default UserApi;
`;
  await fsp.writeFile(path.join(apisDir, 'user.d.ts'), userDts);
  
  // friend.d.ts
  const friendDts = `export declare const FriendApi: {
  getBuddy(forceRefresh?: boolean): Promise<any[]>;
};

export declare const NTQQFriendApi: typeof FriendApi;
export default FriendApi;
`;
  await fsp.writeFile(path.join(apisDir, 'friend.d.ts'), friendDts);
  
  console.log(`[types] 已生成所有API类型定义`);
}

// 生成OneBot API类型
async function generateOneBotTypes() {
  console.log(`[types] 生成OneBot API类型...`);
  
  const onebotDir = path.join(OVERLAY_DIR, 'types/onebot/api');
  await fsp.mkdir(onebotDir, { recursive: true });
  
  const msgDts = `import { RawMessage } from '../../core/types.js';

export declare class OneBotMsgApi {
  constructor(obContext: any, core: any);
  
  parseMessage(message: RawMessage, quickReply?: boolean): Promise<any>;
  parseMessageV2(
    message: RawMessage,
    parseMultiForward?: boolean,
    rawMessage?: boolean,
    quickReply?: boolean
  ): Promise<any>;
}

export default OneBotMsgApi;
`;
  
  await fsp.writeFile(path.join(onebotDir, 'msg.d.ts'), msgDts);
  console.log(`[types] 已生成 onebot/api/msg.d.ts`);
}

// 主函数
async function main() {
  try {
    console.log('======================================');
    console.log('NapCat Overlay 生成器');
    console.log('======================================');
    
    // 1. 克隆NapCat源代码
    const commit = await cloneNapCat();
    
    // 2. 提取枚举
    const enums = extractEnumsFromSource(TMP_DIR);
    
    // 3. 写入枚举到运行时
    await writeEnums(enums, commit);
    
    // 4. 生成TypeScript类型定义
    await generateTypeDefinitions(enums);
    
    // 5. 生成OneBot API类型
    await generateOneBotTypes();
    
    console.log('======================================');
    console.log('✓ Overlay生成完成！');
    console.log(`  NapCat版本: ${NAPCAT_REF}`);
    console.log(`  Commit: ${commit}`);
    console.log('======================================');
    
  } catch (error) {
    console.error('✗ 生成失败:', error);
    process.exit(1);
  }
}

// 执行
if (require.main === module) {
  main();
}

module.exports = { main };

