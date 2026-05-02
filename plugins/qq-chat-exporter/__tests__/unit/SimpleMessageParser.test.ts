/**
 * SimpleMessageParser unit tests.
 *
 * One test per element family. The parser is the place most regressions show
 * up because every NTQQ release adds a new element subtype.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createMockCore } from '../helpers/MockNapCatCore.js';
import { installBridge, uninstallBridge } from '../helpers/installBridge.js';
import { silenceConsole } from '../helpers/silenceConsole.js';
import { msg } from '../fixtures/builders.js';

const T = 1704067200;

async function loadParser() {
    // Dynamic import — the parser pulls in the overlay, which requires the
    // bridge to be installed before the module is evaluated.
    return await import('../../lib/core/parser/SimpleMessageParser.js');
}

let console_!: ReturnType<typeof silenceConsole>;

test.beforeEach(() => {
    console_ = silenceConsole();
    installBridge({ core: createMockCore() });
});

test.afterEach(() => {
    uninstallBridge();
    console_.restore();
});

test('parses plain text messages', async () => {
    const { SimpleMessageParser } = await loadParser();
    const parser = new SimpleMessageParser({ html: 'none' });
    const m = msg().sender({ uid: 'u_alice', uin: '11111', nick: 'Alice' }).text('hello world').at_time(T).build();
    const [parsed] = await parser.parseMessages([m]);
    assert.equal(parsed.sender.name, 'Alice');
    assert.equal(parsed.content.text, 'hello world');
    assert.equal(parsed.content.elements[0].type, 'text');
    assert.equal(parsed.recalled, false);
});

test('uses group card name in preference to nickname', async () => {
    const { SimpleMessageParser } = await loadParser();
    const parser = new SimpleMessageParser({ html: 'none' });
    const m = msg({ chatType: 2 })
        .sender({ uid: 'u_alice', uin: '11111', nick: 'Alice', card: 'Alice (PM)', remark: 'A.Pm' })
        .text('hi')
        .build();
    const [parsed] = await parser.parseMessages([m]);
    assert.equal(parsed.sender.name, 'Alice (PM)');
    assert.equal(parsed.sender.groupCard, 'Alice (PM)');
    assert.equal(parsed.sender.remark, 'A.Pm');
    assert.equal(parsed.sender.nickname, 'Alice');
});

test('private chat ignores group card and uses remark first', async () => {
    const { SimpleMessageParser } = await loadParser();
    const parser = new SimpleMessageParser({ html: 'none' });
    const m = msg({ chatType: 1 })
        .sender({ uid: 'u_alice', uin: '11111', nick: 'Alice', card: 'Alice (PM)', remark: 'A.Pm' })
        .text('hi')
        .build();
    const [parsed] = await parser.parseMessages([m]);
    assert.equal(parsed.sender.name, 'A.Pm');
});

test('group chat with preferGroupMemberName=false falls back to nickname', async () => {
    const { SimpleMessageParser } = await loadParser();
    const parser = new SimpleMessageParser({ html: 'none', preferGroupMemberName: false });
    const m = msg({ chatType: 2 })
        .sender({ uid: 'u_alice', uin: '11111', nick: 'Alice', card: 'Alice (PM)' })
        .text('hi')
        .build();
    const [parsed] = await parser.parseMessages([m]);
    assert.equal(parsed.sender.name, 'Alice');
});

test('parses @everyone and @user mentions', async () => {
    const { SimpleMessageParser } = await loadParser();
    const parser = new SimpleMessageParser({ html: 'none' });
    const m = msg()
        .sender({ uid: 'u_charlie', uin: '33333', nick: 'Charlie' })
        .atAll()
        .text(' ')
        .at(11111, 'Alice', 'u_alice')
        .text(' please review')
        .build();
    const [parsed] = await parser.parseMessages([m]);
    assert.equal(parsed.content.mentions.length, 2);
    assert.equal(parsed.content.mentions[0].type, 'all');
    assert.equal(parsed.content.mentions[1].type, 'user');
    assert.equal(parsed.content.mentions[1].name, 'Alice');
    assert.match(parsed.content.text, /@全体成员/);
    assert.match(parsed.content.text, /please review/);
});

test('parses image element with metadata', async () => {
    const { SimpleMessageParser } = await loadParser();
    const parser = new SimpleMessageParser({ html: 'none' });
    const m = msg()
        .image({ filename: 'cat.jpg', width: 1024, height: 768, md5: 'cafebabe' })
        .build();
    const [parsed] = await parser.parseMessages([m]);
    const el = parsed.content.elements[0];
    assert.equal(el.type, 'image');
    assert.equal(el.data.filename, 'cat.jpg');
    assert.equal(el.data.width, 1024);
    assert.equal(el.data.md5, 'cafebabe');
    assert.equal(parsed.content.resources[0].type, 'image');
});

test('parses face / market_face elements', async () => {
    const { SimpleMessageParser } = await loadParser();
    const parser = new SimpleMessageParser({ html: 'none' });
    const m = msg()
        .face(178, '[微笑]')
        .marketFace({ name: '[doge]', emojiId: 'doge_v1' })
        .build();
    const [parsed] = await parser.parseMessages([m]);
    const types = parsed.content.elements.map((e) => e.type);
    assert.deepEqual(types, ['face', 'market_face']);
    assert.equal(parsed.content.elements[0].data.id, '178');
    assert.equal(parsed.content.elements[1].data.name, '[doge]');
});

test('parses voice / video / file elements', async () => {
    const { SimpleMessageParser } = await loadParser();
    const parser = new SimpleMessageParser({ html: 'none' });
    const m = msg()
        .voice({ filename: 'v.silk', duration: 5, size: 4000 })
        .video({ filename: 'v.mp4', duration: 30, size: 20000 })
        .file({ filename: 'doc.pdf', size: 9000 })
        .build();
    const [parsed] = await parser.parseMessages([m]);
    const types = parsed.content.elements.map((e) => e.type);
    assert.deepEqual(types, ['audio', 'video', 'file']);
    assert.equal(parsed.content.elements[0].data.duration, 5);
    assert.equal(parsed.content.elements[1].data.duration, 30);
    assert.equal(parsed.content.elements[2].data.size, 9000);
});

test('marks recalled messages', async () => {
    const { SimpleMessageParser } = await loadParser();
    const parser = new SimpleMessageParser({ html: 'none' });
    const m = msg().text('whoops').recall(T + 5).build();
    const [parsed] = await parser.parseMessages([m]);
    assert.equal(parsed.recalled, true);
});

test('reply element resolves referenced content via global map', async () => {
    const { SimpleMessageParser } = await loadParser();
    const parser = new SimpleMessageParser({ html: 'none' });
    const original = msg()
        .sender({ uid: 'u_bob', uin: '22222', nick: 'Bob' })
        .text('the question')
        .at_time(T + 0)
        .build();
    const reply = msg()
        .sender({ uid: 'u_alice', uin: '11111', nick: 'Alice' })
        .reply({ sourceMsgId: original.msgId, msgSeq: original.msgSeq, msgTime: Number(original.msgTime) })
        .text('the answer')
        .at_time(T + 60)
        .build();
    const parsed = await parser.parseMessages([original, reply]);
    const replyEl = parsed[1].content.elements.find((e) => e.type === 'reply');
    assert.ok(replyEl, 'expected a reply element');
    assert.equal(replyEl!.data.referencedMessageId, original.msgId);
    assert.equal(replyEl!.data.content, 'the question');
    assert.equal(replyEl!.data.senderName, 'Bob');
});

test('forward element preserves resId and surfaces records via map', async () => {
    const { SimpleMessageParser } = await loadParser();
    const parser = new SimpleMessageParser({ html: 'none' });
    const inner = [
        msg().sender({ uid: 'u_alice' }).text('inner1').at_time(T + 0).build(),
        msg().sender({ uid: 'u_alice' }).text('inner2').at_time(T + 60).build()
    ];
    const m = msg().forward({ resId: 'fw_001', records: inner }).at_time(T + 120).build();
    const [parsed] = await parser.parseMessages([m]);
    const fw = parsed.content.elements[0];
    assert.equal(fw.type, 'forward');
    assert.equal(fw.data.resId, 'fw_001');
});
