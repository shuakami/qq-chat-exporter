/**
 * Fixture builders.
 *
 * Hand-writing NTQQ-shaped RawMessage objects in a test is painful — every
 * message is a deeply nested object with a dozen-plus optional fields. The
 * builders here trade verbosity for fluency:
 *
 *     msg('text-1', { senderUid: 'u_alice' })
 *         .at(0)
 *         .text('Hi ')
 *         .at(123, 'Bob')
 *         .text('!')
 *         .build()
 *
 *     conversation(privatePeer('u_alice'))
 *         .add(msg().text('first').build())
 *         .add(msg().image({ url: 'https://x/1.png' }).build())
 *         .build()
 */

import type { MessageElement, RawMessage } from 'NapCatQQ/src/core/index.js';
import type { MockConversation, MockPeer } from '../helpers/types.js';

let _counter = 0;
const nextId = () => `m_${++_counter}`;
const nextSeq = () => String(1000 + _counter);

export function resetIds(): void {
    _counter = 0;
}

/* ------------------------------ Peer helpers ------------------------------ */

export function privatePeer(uid: string): MockPeer {
    return { chatType: 1, peerUid: uid };
}

export function groupPeer(groupCode: string): MockPeer {
    return { chatType: 2, peerUid: groupCode };
}

/* -------------------------- MessageBuilder (chainable) -------------------- */

interface InitialMsgOptions {
    msgId?: string;
    msgSeq?: string;
    msgTime?: number;
    msgType?: number;
    chatType?: number;
    peerUid?: string;
    senderUid?: string;
    senderUin?: string;
    sendNickName?: string;
    sendMemberName?: string;
    sendRemarkName?: string;
    recallTime?: string;
}

export class MessageBuilder {
    private msg: RawMessage;
    private elements: MessageElement[];
    private records: RawMessage[] = [];

    constructor(opts: InitialMsgOptions = {}) {
        const id = opts.msgId ?? nextId();
        const seq = opts.msgSeq ?? nextSeq();
        // Default time is deterministic: 2024-01-01 00:00:00 + 60s per message
        const baseTime = 1704067200; // 2024-01-01T00:00:00Z
        this.elements = [];
        const initial: Partial<RawMessage> = {
            msgId: id,
            msgSeq: seq,
            msgTime: opts.msgTime != null ? String(opts.msgTime) : String(baseTime + _counter * 60),
            msgType: opts.msgType ?? 2,
            chatType: opts.chatType ?? 1,
            peerUid: opts.peerUid ?? 'peer_default',
            senderUid: opts.senderUid ?? 'u_alice',
            senderUin: opts.senderUin ?? '11111',
            sendNickName: opts.sendNickName ?? 'Alice',
            sendMemberName: opts.sendMemberName ?? '',
            sendRemarkName: opts.sendRemarkName ?? '',
            recallTime: opts.recallTime ?? '0',
            elements: this.elements
        };
        this.msg = initial as RawMessage;
    }

    text(content: string): this {
        this.elements.push({
            elementType: 1,
            textElement: { content, atType: 0, atUid: '', atNtUid: '' }
        } as unknown as MessageElement);
        return this;
    }

    atAll(): this {
        this.elements.push({
            elementType: 1,
            textElement: { content: '@全体成员', atType: 1, atUid: '0', atNtUid: '' }
        } as unknown as MessageElement);
        return this;
    }

    at(uin: string | number, name: string, uid?: string): this {
        this.elements.push({
            elementType: 1,
            textElement: {
                content: `@${name}`,
                atType: 2,
                atUid: String(uin),
                atNtUid: uid ?? `u_${uin}`
            }
        } as unknown as MessageElement);
        return this;
    }

    face(faceIndex: number, faceText?: string): this {
        this.elements.push({
            elementType: 6,
            faceElement: { faceIndex, faceText: faceText ?? '' }
        } as unknown as MessageElement);
        return this;
    }

    marketFace(opts: { name?: string; tabName?: string; emojiId?: string; emojiPackageId?: number; key?: string }): this {
        this.elements.push({
            elementType: 37,
            marketFaceElement: {
                faceName: opts.name ?? '商城表情',
                tabName: opts.tabName ?? '',
                emojiId: opts.emojiId ?? 'emoji_001',
                emojiPackageId: opts.emojiPackageId ?? 1,
                key: opts.key ?? 'mock_key'
            }
        } as unknown as MessageElement);
        return this;
    }

    image(opts: {
        filename?: string;
        size?: number;
        width?: number;
        height?: number;
        md5?: string;
        url?: string;
    } = {}): this {
        this.elements.push({
            elementType: 2,
            picElement: {
                fileName: opts.filename ?? 'pic.jpg',
                fileSize: String(opts.size ?? 1024),
                picWidth: opts.width ?? 800,
                picHeight: opts.height ?? 600,
                md5HexStr: opts.md5 ?? 'deadbeef',
                originImageUrl: opts.url ?? 'https://multimedia.nt.qq.com.cn/mock.jpg'
            }
        } as unknown as MessageElement);
        return this;
    }

    file(opts: { filename?: string; size?: number; md5?: string } = {}): this {
        this.elements.push({
            elementType: 3,
            fileElement: {
                fileName: opts.filename ?? 'doc.pdf',
                fileSize: String(opts.size ?? 2048),
                fileMd5: opts.md5 ?? 'abcdef0123456789'
            }
        } as unknown as MessageElement);
        this.msg.msgType = 3;
        return this;
    }

    voice(opts: { filename?: string; size?: number; duration?: number } = {}): this {
        this.elements.push({
            elementType: 4,
            pttElement: {
                fileName: opts.filename ?? 'voice.silk',
                fileSize: String(opts.size ?? 4096),
                duration: opts.duration ?? 3
            }
        } as unknown as MessageElement);
        this.msg.msgType = 6;
        return this;
    }

    video(opts: { filename?: string; size?: number; duration?: number; thumbSize?: number } = {}): this {
        this.elements.push({
            elementType: 4,
            videoElement: {
                fileName: opts.filename ?? 'video.mp4',
                fileSize: String(opts.size ?? 8192),
                duration: opts.duration ?? 10,
                thumbSize: String(opts.thumbSize ?? 2048)
            }
        } as unknown as MessageElement);
        this.msg.msgType = 7;
        return this;
    }

    reply(opts: {
        sourceMsgId: string;
        senderUin?: string;
        senderName?: string;
        content?: string;
        msgSeq?: string;
        msgTime?: number;
    }): this {
        this.elements.push({
            elementType: 7,
            replyElement: {
                sourceMsgIdInRecords: opts.sourceMsgId,
                replayMsgId: opts.sourceMsgId,
                senderUin: opts.senderUin ?? '11111',
                senderUinStr: opts.senderUin ?? '11111',
                replayMsgSeq: opts.msgSeq ?? '999',
                replyMsgTime: String(opts.msgTime ?? 1704067100),
                sourceMsgTextElems: [{ textElemContent: opts.content ?? '' }]
            }
        } as unknown as MessageElement);
        this.msg.msgType = 9;
        return this;
    }

    forward(opts: { resId: string; xmlContent?: string; records?: RawMessage[] }): this {
        this.elements.push({
            elementType: 16,
            multiForwardMsgElement: {
                resId: opts.resId,
                xmlContent: opts.xmlContent ?? '<msg>合并转发</msg>'
            }
        } as unknown as MessageElement);
        if (opts.records) this.records = opts.records;
        this.msg.msgType = 8;
        return this;
    }

    arkJson(payload: object): this {
        this.elements.push({
            elementType: 10,
            arkElement: { bytesData: JSON.stringify(payload) }
        } as unknown as MessageElement);
        this.msg.msgType = 11;
        return this;
    }

    greyTip(content: string): this {
        this.elements.push({
            elementType: 8,
            grayTipElement: {
                subElementType: 1,
                jsonGrayTipElement: { busiId: 1, jsonStr: JSON.stringify({ items: [{ txt: content }] }) }
            }
        } as unknown as MessageElement);
        this.msg.msgType = 5;
        return this;
    }

    recall(time: number = Math.floor(Date.now() / 1000)): this {
        this.msg.recallTime = String(time);
        return this;
    }

    /** Stamp a deterministic msgTime (Unix seconds). */
    at_time(seconds: number): this {
        this.msg.msgTime = String(seconds);
        return this;
    }

    sender(opts: { uid?: string; uin?: string; nick?: string; card?: string; remark?: string }): this {
        if (opts.uid) this.msg.senderUid = opts.uid;
        if (opts.uin) this.msg.senderUin = opts.uin;
        if (opts.nick) this.msg.sendNickName = opts.nick;
        if (opts.card) this.msg.sendMemberName = opts.card;
        if (opts.remark) this.msg.sendRemarkName = opts.remark;
        return this;
    }

    build(): RawMessage {
        if (this.records.length > 0) {
            (this.msg as RawMessage & { records: RawMessage[] }).records = this.records;
        }
        return this.msg;
    }
}

export function msg(opts: InitialMsgOptions = {}): MessageBuilder {
    return new MessageBuilder(opts);
}

/* --------------------------- ConversationBuilder --------------------------- */

export class ConversationBuilder {
    private peer: MockPeer;
    private chatInfo: MockConversation['chatInfo'];
    private messages: RawMessage[] = [];

    constructor(peer: MockPeer, chatInfo?: MockConversation['chatInfo']) {
        this.peer = peer;
        this.chatInfo = chatInfo;
    }

    info(chatInfo: NonNullable<MockConversation['chatInfo']>): this {
        this.chatInfo = chatInfo;
        return this;
    }

    add(...rawMessages: RawMessage[]): this {
        for (const m of rawMessages) {
            // Stamp peer info if missing
            if (!m.peerUid) m.peerUid = this.peer.peerUid;
            if (!m.chatType) m.chatType = this.peer.chatType;
            this.messages.push(m);
        }
        return this;
    }

    build(): MockConversation {
        return { peer: this.peer, chatInfo: this.chatInfo, messages: this.messages };
    }
}

export function conversation(peer: MockPeer, chatInfo?: MockConversation['chatInfo']): ConversationBuilder {
    return new ConversationBuilder(peer, chatInfo);
}
