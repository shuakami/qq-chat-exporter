/**
 * Canned conversations used by the integration tests.
 *
 * Each scenario exercises a particular slice of the export pipeline. Keep
 * them deterministic — fixed msgTime / msgSeq so snapshots stay stable.
 */

import type { MockConversation, MockFriend, MockGroup } from '../helpers/types.js';
import { conversation, groupPeer, msg, privatePeer, resetIds } from './builders.js';

const T = 1704067200; // 2024-01-01T00:00:00Z

/* ------------------------------ Friends / Groups ----------------------------- */

export const FRIENDS: MockFriend[] = [
    { uid: 'u_alice', uin: '11111', nick: 'Alice', remark: 'Alice (Real Name)' },
    { uid: 'u_bob', uin: '22222', nick: 'Bob' },
    { uid: 'u_charlie', uin: '33333', nick: 'Charlie' }
];

export const GROUPS: MockGroup[] = [
    {
        groupCode: '999000',
        groupName: 'QCE Testing Group',
        memberCount: 4,
        maxMember: 200,
        members: [
            { uid: 'u_alice', uin: '11111', nick: 'Alice', cardName: 'Alice (PM)', role: 2 },
            { uid: 'u_bob', uin: '22222', nick: 'Bob', cardName: 'Bob (Eng)', role: 3 },
            { uid: 'u_charlie', uin: '33333', nick: 'Charlie', role: 3 },
            { uid: 'self_test_uid', uin: '10000', nick: 'TestSelf', cardName: 'Me', role: 1 }
        ]
    }
];

/* --------------------------- Scenario 1: Plain text -------------------------- */

export function privateTextOnly(): MockConversation {
    resetIds();
    return conversation(privatePeer('u_alice'), { name: 'Alice', type: 'private' })
        .add(msg().sender({ uid: 'u_alice', uin: '11111', nick: 'Alice' }).text('Hello there').at_time(T + 0).build())
        .add(msg().sender({ uid: 'self_test_uid', uin: '10000', nick: 'TestSelf' }).text('General Kenobi!').at_time(T + 60).build())
        .add(msg().sender({ uid: 'u_alice', uin: '11111', nick: 'Alice' }).text('How was your day?').at_time(T + 120).build())
        .build();
}

/* ------------------------- Scenario 2: Mixed elements ------------------------ */

export function groupMixedMedia(): MockConversation {
    resetIds();
    const replyTarget = msg()
        .sender({ uid: 'u_alice', uin: '11111', nick: 'Alice', card: 'Alice (PM)' })
        .text('Anyone seen the build break?')
        .at_time(T + 100)
        .build();

    return conversation(groupPeer('999000'), { name: 'QCE Testing Group', type: 'group', participantCount: 4 })
        .add(replyTarget)
        .add(
            msg()
                .sender({ uid: 'u_bob', uin: '22222', nick: 'Bob', card: 'Bob (Eng)' })
                .text('Looking now ')
                .face(178, '[微笑]')
                .at_time(T + 160)
                .build()
        )
        .add(
            msg()
                .sender({ uid: 'u_bob', uin: '22222', nick: 'Bob', card: 'Bob (Eng)' })
                .image({ filename: 'screenshot.png', width: 1920, height: 1080, md5: 'cafef00d', url: 'https://multimedia.nt.qq.com.cn/screenshot.png' })
                .at_time(T + 165)
                .build()
        )
        .add(
            msg()
                .sender({ uid: 'u_charlie', uin: '33333', nick: 'Charlie' })
                .at(11111, 'Alice', 'u_alice')
                .text(' sentry has the trace, sending now')
                .at_time(T + 200)
                .build()
        )
        .add(
            msg()
                .sender({ uid: 'u_charlie', uin: '33333', nick: 'Charlie' })
                .file({ filename: 'trace.json', size: 51200, md5: 'feedface' })
                .at_time(T + 210)
                .build()
        )
        .add(
            msg()
                .sender({ uid: 'u_alice', uin: '11111', nick: 'Alice', card: 'Alice (PM)' })
                .reply({
                    sourceMsgId: replyTarget.msgId,
                    senderUin: '11111',
                    senderName: 'Alice (PM)',
                    content: 'Anyone seen the build break?',
                    msgSeq: replyTarget.msgSeq,
                    msgTime: Number(replyTarget.msgTime)
                })
                .text('thanks team, fix incoming')
                .at_time(T + 240)
                .build()
        )
        .add(
            msg()
                .sender({ uid: 'u_alice', uin: '11111', nick: 'Alice', card: 'Alice (PM)' })
                .voice({ filename: 'voice_msg.silk', duration: 7, size: 12_000 })
                .at_time(T + 300)
                .build()
        )
        .build();
}

/* ----------------------------- Scenario 3: Recall ---------------------------- */

export function privateWithRecall(): MockConversation {
    resetIds();
    return conversation(privatePeer('u_bob'), { name: 'Bob', type: 'private' })
        .add(msg().sender({ uid: 'u_bob', uin: '22222', nick: 'Bob' }).text('whoops sent wrong link').at_time(T + 0).recall(T + 5).build())
        .add(msg().sender({ uid: 'u_bob', uin: '22222', nick: 'Bob' }).text('https://example.com/correct').at_time(T + 10).build())
        .build();
}

/* ----------------------------- Scenario 4: Forward --------------------------- */

export function privateWithForward(): MockConversation {
    resetIds();
    const inner = [
        msg().sender({ uid: 'u_alice', uin: '11111', nick: 'Alice' }).text('Q1 plan v3').at_time(T + 1000).build(),
        msg().sender({ uid: 'u_alice', uin: '11111', nick: 'Alice' }).image({ filename: 'plan.png', md5: 'abc123' }).at_time(T + 1010).build()
    ];

    return conversation(privatePeer('u_bob'), { name: 'Bob', type: 'private' })
        .add(
            msg()
                .sender({ uid: 'u_alice', uin: '11111', nick: 'Alice' })
                .forward({ resId: 'forward_res_001', xmlContent: '<msg brief="[聊天记录]"></msg>', records: inner })
                .at_time(T + 1500)
                .build()
        )
        .build();
}

/* --------------------------- Scenario 5: Volume ---------------------------- */

/**
 * Creates `count` text messages spanning `count` minutes. Used by fetcher
 * pagination tests — the BatchMessageFetcher splits this across batches and
 * we want to be sure none of the messages get dropped or duplicated.
 */
export function privateVolume(count: number): MockConversation {
    resetIds();
    const builder = conversation(privatePeer('u_alice'), { name: 'Alice', type: 'private' });
    for (let i = 0; i < count; i++) {
        builder.add(
            msg()
                .sender({ uid: 'u_alice', uin: '11111', nick: 'Alice' })
                .text(`message #${i + 1}`)
                .at_time(T + i * 60)
                .build()
        );
    }
    return builder.build();
}
