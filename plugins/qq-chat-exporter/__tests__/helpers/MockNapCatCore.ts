/**
 * MockNapCatCore - factory for a NapCatCore-shaped object suitable for use as
 * the bridge `core` in tests.
 *
 * Why this exists:
 *   The QCE plugin reaches into NapCatQQ via a Bridge proxy
 *   (`globalThis.__NAPCAT_BRIDGE__`). At runtime every `core.apis.X.Y` call
 *   gets forwarded to whatever the Bridge exposes. By providing a Bridge whose
 *   `core` returns deterministic data from in-memory fixtures we can run the
 *   real fetchers / parsers / exporters end-to-end without ever logging into
 *   QQ. One fixture file = one regression test = one lifetime of confidence.
 */

import type { RawMessage } from 'NapCatQQ/src/core/index.js';
import type {
    MockConfig,
    MockConversation,
    MockFriend,
    MockGroup,
    MockGroupMember,
    MockPeer,
    MockSelfInfo
} from './types.js';

interface CallLogEntry {
    timestamp: number;
    api: string;
    args: unknown[];
}

export interface MockNapCatCore {
    apis: {
        MsgApi: MsgApi;
        FileApi: FileApi;
        GroupApi: GroupApi;
        UserApi: UserApi;
        FriendApi: FriendApi;
        WebApi: WebApi;
    };
    context: {
        workingEnv: 1 | 2;
        logger: Logger;
        pathWrapper: { cachePath: string; tmpPath: string; logsPath: string };
        session: SessionFacade;
    };
    selfInfo: MockSelfInfo;

    /* --- test-only escape hatches --- */
    __getCallLog(): readonly CallLogEntry[];
    __clearCallLog(): void;
    __setConversations(conversations: MockConversation[]): void;
    __setFriends(friends: MockFriend[]): void;
    __setGroups(groups: MockGroup[]): void;
}

interface Logger {
    log(...args: unknown[]): void;
    logError(...args: unknown[]): void;
    logWarn(...args: unknown[]): void;
    logDebug(...args: unknown[]): void;
}

interface MsgApi {
    getMsgHistory(peer: MockPeer, msgId: string, count: number, reverse: boolean): Promise<{ msgList: RawMessage[] }>;
    getAioFirstViewLatestMsgs(peer: MockPeer, count: number): Promise<{ msgList: RawMessage[] }>;
    getMultiMsg(params: { peer?: MockPeer; rootMsgId?: string; parentMsgId?: string; forwardId?: string; resId?: string }): Promise<{ msgList: RawMessage[] } | undefined>;
}

interface FileApi {
    downloadMedia(
        msgId: string,
        chatType: number,
        peerUid: string,
        elementId: string,
        thumbPath: string,
        sourcePath: string,
        timeout?: number,
        force?: boolean
    ): Promise<string>;
}

interface GroupApi {
    getGroups(forceRefresh?: boolean): Promise<MockGroup[]>;
    fetchGroupDetail(groupCode: string): Promise<MockGroup | undefined>;
    getGroupMemberAll(groupCode: string, forceRefresh?: boolean): Promise<{ result: { infos: Map<string, MockGroupMember> } }>;
}

interface UserApi {
    getUserDetailInfo(uid: string, noCache?: boolean): Promise<{ uid: string; uin?: string; nick: string; longNick?: string }>;
    getUidByUinV2(uin: string): Promise<string>;
    getRecentContactListSnapShot(): Promise<unknown[]>;
}

interface FriendApi {
    getBuddy(): Promise<MockFriend[]>;
    getFriends(forceRefresh?: boolean): Promise<MockFriend[]>;
    getBuddyV2ExWithCate(): Promise<unknown[]>;
}

interface WebApi {
    getGroupEssenceMsgAll(groupCode: string): Promise<{ msgList: unknown[] }>;
}

interface SessionFacade {
    getMsgService(): {
        getAioFirstViewLatestMsgs(peer: MockPeer, count: number): Promise<{ msgList: RawMessage[] }>;
        getMsgsBySeqRange(peer: MockPeer, endSeq: string, startSeq: string): Promise<{ msgList: RawMessage[] }>;
    };
    getRichMediaService(): Record<string, never>;
}

/**
 * Build a MockNapCatCore from a configuration object.
 *
 * The returned core can be passed to `installBridge({ core })` (or any helper
 * that produces a Bridge) to make the plugin code believe it is talking to a
 * live NapCat instance.
 */
export function createMockCore(config: MockConfig = {}): MockNapCatCore {
    const callLog: CallLogEntry[] = [];
    const logSink = config.logSink ?? (() => undefined);

    const selfInfo: MockSelfInfo = {
        uid: config.selfInfo?.uid ?? 'self_test_uid',
        uin: config.selfInfo?.uin ?? '10000',
        nick: config.selfInfo?.nick ?? 'TestSelf',
        online: config.selfInfo?.online ?? true
    };

    let friends: MockFriend[] = config.friends ? [...config.friends] : [];
    let groups: MockGroup[] = config.groups ? [...config.groups] : [];
    let conversations: MockConversation[] = config.conversations ? [...config.conversations] : [];

    function track(api: string, args: unknown[]): void {
        callLog.push({ timestamp: Date.now(), api, args });
    }

    function findConversation(peer: MockPeer): MockConversation | undefined {
        return conversations.find(
            (c) => c.peer.peerUid === peer.peerUid && c.peer.chatType === peer.chatType
        );
    }

    function sortByTimeDesc(a: RawMessage, b: RawMessage): number {
        const ta = Number(a.msgTime ?? 0);
        const tb = Number(b.msgTime ?? 0);
        return tb - ta;
    }

    const logger: Logger = {
        log: (...args) => logSink('log', args),
        logError: (...args) => logSink('error', args),
        logWarn: (...args) => logSink('warn', args),
        logDebug: (...args) => logSink('debug', args)
    };

    const MsgApi: MsgApi = {
        async getMsgHistory(peer, msgId, count, _reverse) {
            track('MsgApi.getMsgHistory', [peer, msgId, count, _reverse]);
            const conv = findConversation(peer);
            if (!conv) return { msgList: [] };
            const sorted = [...conv.messages].sort(sortByTimeDesc);
            // msgId === '' or '0' means "latest"
            const anchorIdx = msgId && msgId !== '0'
                ? sorted.findIndex((m) => m.msgId === msgId)
                : -1;
            const startIdx = anchorIdx >= 0 ? anchorIdx + 1 : 0;
            const slice = sorted.slice(startIdx, startIdx + count);
            return { msgList: slice };
        },

        async getAioFirstViewLatestMsgs(peer, count) {
            track('MsgApi.getAioFirstViewLatestMsgs', [peer, count]);
            const conv = findConversation(peer);
            if (!conv) return { msgList: [] };
            const sorted = [...conv.messages].sort(sortByTimeDesc);
            return { msgList: sorted.slice(0, count) };
        },

        async getMultiMsg(params) {
            track('MsgApi.getMultiMsg', [params]);
            // Look up forward by resId or rootMsgId across all conversations
            const target = params.forwardId ?? params.resId ?? params.rootMsgId;
            if (!target) return { msgList: [] };
            for (const conv of conversations) {
                for (const msg of conv.messages) {
                    if (msg.msgId === target && Array.isArray((msg as { records?: RawMessage[] }).records)) {
                        return { msgList: (msg as { records: RawMessage[] }).records };
                    }
                    const forwardEl = (msg.elements ?? []).find(
                        (e) => (e as { multiForwardMsgElement?: { resId?: string } })
                            .multiForwardMsgElement?.resId === target
                    );
                    if (forwardEl && Array.isArray((msg as { records?: RawMessage[] }).records)) {
                        return { msgList: (msg as { records: RawMessage[] }).records };
                    }
                }
            }
            return { msgList: [] };
        }
    };

    const FileApi: FileApi = {
        async downloadMedia(msgId, chatType, peerUid, elementId, _thumbPath, sourcePath) {
            track('FileApi.downloadMedia', [msgId, chatType, peerUid, elementId]);
            // Pretend we wrote to sourcePath. The exporter only needs a string back.
            return sourcePath || `/tmp/mock-media/${msgId}-${elementId}`;
        }
    };

    const GroupApi: GroupApi = {
        async getGroups(forceRefresh) {
            track('GroupApi.getGroups', [forceRefresh]);
            return groups.map((g) => ({ ...g, members: undefined }));
        },
        async fetchGroupDetail(groupCode) {
            track('GroupApi.fetchGroupDetail', [groupCode]);
            const g = groups.find((x) => x.groupCode === groupCode);
            return g ? { ...g, members: undefined } : undefined;
        },
        async getGroupMemberAll(groupCode, forceRefresh) {
            track('GroupApi.getGroupMemberAll', [groupCode, forceRefresh]);
            const g = groups.find((x) => x.groupCode === groupCode);
            const infos = new Map<string, MockGroupMember>();
            for (const m of g?.members ?? []) infos.set(m.uid, m);
            return { result: { infos } };
        }
    };

    const UserApi: UserApi = {
        async getUserDetailInfo(uid, noCache) {
            track('UserApi.getUserDetailInfo', [uid, noCache]);
            const f = friends.find((x) => x.uid === uid || x.uin === uid);
            if (f) return { uid: f.uid, uin: f.uin, nick: f.nick, longNick: f.longNick };
            for (const g of groups) {
                const m = (g.members ?? []).find((x) => x.uid === uid || x.uin === uid);
                if (m) return { uid: m.uid, uin: m.uin, nick: m.nick };
            }
            return { uid, nick: `Unknown_${uid}` };
        },
        async getUidByUinV2(uin) {
            track('UserApi.getUidByUinV2', [uin]);
            const f = friends.find((x) => x.uin === uin);
            if (f) return f.uid;
            for (const g of groups) {
                const m = (g.members ?? []).find((x) => x.uin === uin);
                if (m) return m.uid;
            }
            return `u_${uin}`;
        },
        async getRecentContactListSnapShot() {
            track('UserApi.getRecentContactListSnapShot', []);
            return [];
        }
    };

    const FriendApi: FriendApi = {
        async getBuddy() {
            track('FriendApi.getBuddy', []);
            return [...friends];
        },
        async getFriends(forceRefresh) {
            track('FriendApi.getFriends', [forceRefresh]);
            return [...friends];
        },
        async getBuddyV2ExWithCate() {
            track('FriendApi.getBuddyV2ExWithCate', []);
            const cats = new Map<number, { categoryId: number; categoryName: string; buddyList: MockFriend[] }>();
            for (const f of friends) {
                const cid = f.categoryId ?? 0;
                if (!cats.has(cid)) cats.set(cid, { categoryId: cid, categoryName: f.categoryName ?? 'Default', buddyList: [] });
                cats.get(cid)!.buddyList.push(f);
            }
            return Array.from(cats.values());
        }
    };

    const WebApi: WebApi = {
        async getGroupEssenceMsgAll(groupCode) {
            track('WebApi.getGroupEssenceMsgAll', [groupCode]);
            return { msgList: [] };
        }
    };

    const session: SessionFacade = {
        getMsgService() {
            return {
                getAioFirstViewLatestMsgs: (peer, count) =>
                    MsgApi.getAioFirstViewLatestMsgs(peer, count),
                async getMsgsBySeqRange(peer, endSeq, startSeq) {
                    track('session.getMsgsBySeqRange', [peer, endSeq, startSeq]);
                    const conv = findConversation(peer);
                    if (!conv) return { msgList: [] };
                    const lo = parseInt(endSeq, 10);
                    const hi = parseInt(startSeq, 10);
                    return {
                        msgList: conv.messages.filter((m) => {
                            const s = parseInt(m.msgSeq ?? '0', 10);
                            return s >= lo && s <= hi;
                        }).sort(sortByTimeDesc)
                    };
                }
            };
        },
        getRichMediaService() {
            return {};
        }
    };

    return {
        apis: { MsgApi, FileApi, GroupApi, UserApi, FriendApi, WebApi },
        context: {
            workingEnv: config.workingEnv ?? 2,
            logger,
            pathWrapper: {
                cachePath: config.paths?.cachePath ?? '/tmp/qce-test-cache',
                tmpPath: config.paths?.tmpPath ?? '/tmp/qce-test-tmp',
                logsPath: config.paths?.logsPath ?? '/tmp/qce-test-logs'
            },
            session
        },
        selfInfo,

        __getCallLog: () => callLog,
        __clearCallLog: () => { callLog.length = 0; },
        __setConversations: (next) => { conversations = [...next]; },
        __setFriends: (next) => { friends = [...next]; },
        __setGroups: (next) => { groups = [...next]; }
    };
}
