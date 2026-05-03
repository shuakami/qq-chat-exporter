import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSenderFilter } from '../../lib/api/senderFilter.js';

describe('buildSenderFilter', () => {
    it('returns null when both lists are empty', () => {
        assert.equal(buildSenderFilter(undefined, undefined), null);
        assert.equal(buildSenderFilter([], []), null);
        assert.equal(buildSenderFilter(null, null), null);
    });

    it('keeps only senders in includeUserUins when set', () => {
        const filter = buildSenderFilter(['111', '222'], undefined);
        assert.ok(filter, 'filter should be returned');
        assert.equal(filter!('111'), true);
        assert.equal(filter!('222'), true);
        assert.equal(filter!('333'), false);
        assert.equal(filter!(''), false);
        assert.equal(filter!(null), false);
        assert.equal(filter!(undefined), false);
    });

    it('drops senders in excludeUserUins when set', () => {
        const filter = buildSenderFilter(undefined, ['999']);
        assert.ok(filter);
        assert.equal(filter!('999'), false);
        assert.equal(filter!('111'), true);
        assert.equal(filter!(''), true);
    });

    it('exclude wins when a uin is in both lists', () => {
        const filter = buildSenderFilter(['111', '222'], ['111']);
        assert.ok(filter);
        assert.equal(filter!('111'), false);
        assert.equal(filter!('222'), true);
        assert.equal(filter!('333'), false);
    });

    it('handles numeric senderUin and trims whitespace in lists', () => {
        const filter = buildSenderFilter([' 111 ', '222'], ['  333\t']);
        assert.ok(filter);
        assert.equal(filter!(111), true);
        assert.equal(filter!(222), true);
        assert.equal(filter!(333), false);
        assert.equal(filter!('444'), false);
    });

    it('ignores empty strings inside lists', () => {
        const filter = buildSenderFilter(['', '   ', '111'], []);
        assert.ok(filter);
        assert.equal(filter!('111'), true);
        assert.equal(filter!('222'), false);
    });

    it('returns null if every entry in both lists is blank', () => {
        assert.equal(buildSenderFilter(['', '   '], ['\t']), null);
    });
});
