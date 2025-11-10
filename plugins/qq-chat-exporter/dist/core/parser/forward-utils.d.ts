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
export interface ForwardMetadata {
    title?: string;
    summary?: string;
}
interface ForwardFetchOptions {
    core?: NapCatCore | null;
    element?: any;
    messageId?: string;
    bridge?: any;
}
export declare function fetchForwardMessagesFromContext(options: ForwardFetchOptions): Promise<ForwardMessageEntry[]>;
export declare function extractForwardMetadata(xml?: string | null): ForwardMetadata;
export {};
//# sourceMappingURL=forward-utils.d.ts.map
