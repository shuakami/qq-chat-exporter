/**
 * Issue #450：端口被占用 / 被 Windows 保留时，应给出明确可操作的启动失败提示，
 * 而不是把原始 error 直接抛出、非 debug 模式下静默挂掉。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeServerStartupError } from '../../lib/utils/serverStartupError.js';

describe('describeServerStartupError', () => {
    it('EADDRINUSE 时给出端口占用 / WinNAT 保留的可操作提示，并带上端口号', () => {
        const msg = describeServerStartupError({ code: 'EADDRINUSE', message: 'listen EADDRINUSE: address already in use 0.0.0.0:40653' }, 40653);
        assert.match(msg, /端口 40653/);
        assert.match(msg, /占用|保留/);
        // 必须包含可直接执行的修复命令
        assert.match(msg, /net stop winnat/);
        assert.match(msg, /netsh interface ipv4 add excludedportrange protocol=tcp startport=40653/);
        assert.match(msg, /net start winnat/);
    });

    it('EACCES 时提示权限不足', () => {
        const msg = describeServerStartupError({ code: 'EACCES', message: 'listen EACCES' }, 40653);
        assert.match(msg, /端口 40653/);
        assert.match(msg, /权限/);
    });

    it('其它错误回退到原始 message', () => {
        const msg = describeServerStartupError({ code: 'EOTHER', message: 'boom' }, 40653);
        assert.match(msg, /服务器启动失败/);
        assert.match(msg, /boom/);
    });

    it('error 为空时不抛异常', () => {
        const msg = describeServerStartupError(undefined, 40653);
        assert.match(msg, /服务器启动失败/);
    });
});
