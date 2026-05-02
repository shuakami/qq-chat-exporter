/**
 * Shared types for the test harness.
 * Kept loose because the production code talks to NTQQ shaped objects via the
 * overlay bridge — strict typing the entire surface would require shipping
 * the real NapCatQQ type bundle, which is not available in this repo.
 */

import type { RawMessage } from 'NapCatQQ/src/core/index.js';

export type ChatType = 1 | 2 | 100 | 4;

export interface MockPeer {
    chatType: ChatType;
    peerUid: string;
    guildId?: string;
}

export interface MockFriend {
    uid: string;
    uin: string;
    nick: string;
    remark?: string;
    longNick?: string;
    avatarUrl?: string;
    categoryId?: number;
    categoryName?: string;
}

export interface MockGroupMember {
    uid: string;
    uin: string;
    nick: string;
    cardName?: string;
    role?: number;
    joinTime?: number;
    avatarUrl?: string;
}

export interface MockGroup {
    groupCode: string;
    groupName: string;
    memberCount?: number;
    maxMember?: number;
    avatarUrl?: string;
    remarkName?: string;
    members?: MockGroupMember[];
}

export interface MockConversation {
    peer: MockPeer;
    chatInfo?: {
        name?: string;
        type?: 'private' | 'group' | 'temp';
        avatar?: string;
        participantCount?: number;
    };
    messages: RawMessage[];
}

export interface MockSelfInfo {
    uid: string;
    uin: string;
    nick: string;
    online: boolean;
}

export interface MockConfig {
    selfInfo?: Partial<MockSelfInfo>;
    friends?: MockFriend[];
    groups?: MockGroup[];
    conversations?: MockConversation[];
    /** Working environment: 1=shell, 2=framework. Defaults to 2. */
    workingEnv?: 1 | 2;
    /** Override paths exposed via core.context.pathWrapper */
    paths?: {
        cachePath?: string;
        tmpPath?: string;
        logsPath?: string;
    };
    /** Optional logger sink. Defaults to a silent in-memory logger. */
    logSink?: (level: 'log' | 'error' | 'warn' | 'debug', args: unknown[]) => void;
}
