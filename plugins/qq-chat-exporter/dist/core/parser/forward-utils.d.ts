import type { NapCatCore } from 'NapCatQQ/src/core/index.js';
export interface ForwardMessageEntry {
    senderName: string;
    senderUid?: string;
    senderUin?: string;
    messageId?: string;
    time?: string;
    text: string;
    raw?: any;
}
export interface ForwardPreviewEntry {
    senderName?: string;
    text: string;
}
type ForwardLogLevel = 'debug' | 'info' | 'warn' | 'error';
type ForwardLogger = (level: ForwardLogLevel, message: string) => void;
interface ForwardFetchOptions {
    core?: NapCatCore | null;
    element?: any;
    messageId?: string;
    bridge?: any;
    log?: ForwardLogger;
}
export interface ForwardMetadata {
    title?: string;
    summary?: string;
    totalCount?: number;
    previews?: ForwardPreviewEntry[];
}
export declare function fetchForwardMessagesFromContext(options: ForwardFetchOptions): Promise<ForwardMessageEntry[]>;
export declare function extractForwardMetadata(xml?: string | null): ForwardMetadata;
export declare function estimateForwardMessageCount(element: any, metadata?: ForwardMetadata, messages?: ForwardMessageEntry[]): number;
export declare function buildFallbackMessagesFromMetadata(metadata: ForwardMetadata): ForwardMessageEntry[];
export {};
//# sourceMappingURL=forward-utils.d.ts.map