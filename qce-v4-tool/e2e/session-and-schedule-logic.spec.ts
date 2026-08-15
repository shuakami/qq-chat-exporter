/**
 * Pure logic regression tests. No frontend/mock server needed.
 *
 * Issue #649: session lists must never contain duplicated entries, and group
 * sessions must not leak into the friend collection.
 * Issue #646: scheduled HTML exports must keep the self-contained option when a
 * task is created and when it is loaded back into the wizard form.
 */

import { test, expect } from '@playwright/test';
import { dedupeFriends, dedupeGroups, dedupeSessionItems } from '@/lib/session-dedupe';
import { buildSpecialFriends } from '@/lib/special-contacts';
import { scheduledExportConfigToForm, scheduledExportFormToConfig } from '@/hooks/use-scheduled-exports';
import type { CreateScheduledExportForm, Friend, Group, RecentContact } from '@/types/api';

test.describe('session deduplication (issue #649)', () => {
    test('groups and friends keep the first occurrence of every identity', () => {
        const groups = [
            { groupCode: '111', groupName: 'A' },
            { groupCode: '222', groupName: 'B' },
            { groupCode: '111', groupName: 'A copy' },
        ] as Group[];
        expect(dedupeGroups(groups).map((g) => g.groupName)).toEqual(['A', 'B']);

        const friends = [
            { uid: 'u_a', uin: 1, nick: 'A' },
            { uid: 'u_a', uin: 1, nick: 'A copy' },
            { uid: '', uin: 2, nick: 'B' },
        ] as Friend[];
        expect(dedupeFriends(friends).map((f) => f.nick)).toEqual(['A', 'B']);
    });

    test('same id in different session types stays separate', () => {
        const items = [
            { id: '123', type: 'group' as const },
            { id: '123', type: 'friend' as const },
            { id: '123', type: 'group' as const },
        ];
        expect(dedupeSessionItems(items)).toHaveLength(2);
    });

    test('special contacts exclude groups and already known sessions', () => {
        const contacts = [
            { chatType: 2, peerUid: '111', peerUin: '111', classification: 'special' },
            { chatType: 1, peerUid: 'u_known', peerUin: '900', classification: 'special' },
            { chatType: 1, peerUid: 'u_bot', peerUin: '901', classification: 'special' },
            { chatType: 1, peerUid: 'u_friend', peerUin: '902', classification: 'friend' },
        ] as RecentContact[];

        const specials = buildSpecialFriends(contacts, new Set(['u_known']));

        expect(specials.map((f) => f.uid)).toEqual(['u_bot']);
    });
});

test.describe('scheduled self-contained HTML (issue #646)', () => {
    const baseForm: CreateScheduledExportForm = {
        name: 'nightly',
        chatType: 2,
        peerUid: '111',
        sessionName: '测试群',
        format: 'HTML',
        scheduleType: 'daily',
        executeTime: '02:00',
        timeRangeType: 'yesterday',
        enabled: true,
        embedResourcesAsDataUri: true,
    };

    test('form option is persisted into the task options and read back', () => {
        const config = scheduledExportFormToConfig(baseForm);
        expect(config.options.embedResourcesAsDataUri).toBe(true);

        const form = scheduledExportConfigToForm(config);
        expect(form.embedResourcesAsDataUri).toBe(true);
    });

    test('option defaults to disabled when the form does not set it', () => {
        const config = scheduledExportFormToConfig({ ...baseForm, embedResourcesAsDataUri: undefined });
        expect(config.options.embedResourcesAsDataUri).toBe(false);
    });
});
