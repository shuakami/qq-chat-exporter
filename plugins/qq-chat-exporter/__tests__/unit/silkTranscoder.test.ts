import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
    isSilkBuffer,
    transcodeSilkBufferToMp3,
    transcodeSilkFileToMp3,
} from '../../lib/core/audio/silkTranscoder.js';

/**
 * issue #306 — 把 QQ 缓存的 SILK 语音转码成浏览器可播的 MP3。
 *
 * 不内嵌固定 SILK 字节流（不同版本 silk-wasm 输出不一致），改成在跑测试时
 * 现场用 silk-wasm.encode() 把 1 秒 PCM 编出 SILK，再喂回 transcoder。
 */

function tmpDir(prefix: string): { dir: string; cleanup: () => void } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** 1 秒 24 kHz 单声道 sine 波 PCM_S16LE。silk-wasm 喜欢 sine 多过白噪声。 */
function makeSinePcm(sampleRate: number, durationSec: number, freqHz = 440): Buffer {
    const totalSamples = Math.floor(sampleRate * durationSec);
    const buf = Buffer.alloc(totalSamples * 2);
    for (let i = 0; i < totalSamples; i++) {
        const v = Math.round(Math.sin((2 * Math.PI * freqHz * i) / sampleRate) * 16384);
        buf.writeInt16LE(v, i * 2);
    }
    return buf;
}

async function makeSilkSample(sampleRate = 24000): Promise<Buffer> {
    const pcm = makeSinePcm(sampleRate, 1.0);
    const silkMod: any = await import('silk-wasm');
    const encode = silkMod.encode ?? silkMod.default?.encode;
    const result = await encode(pcm, sampleRate);
    return Buffer.from(result.data);
}

test('isSilkBuffer 命中 #!SILK_V3 头', () => {
    const headOnly = Buffer.concat([Buffer.from('#!SILK_V3'), Buffer.alloc(8, 0)]);
    assert.equal(isSilkBuffer(headOnly), true);
});

test('isSilkBuffer 命中 0x02 + #!SILK_V3 头', () => {
    const headOnly = Buffer.concat([Buffer.from([0x02]), Buffer.from('#!SILK_V3'), Buffer.alloc(8, 0)]);
    assert.equal(isSilkBuffer(headOnly), true);
});

test('isSilkBuffer 对真 AMR / WAV / 空 / 短输入返回 false', () => {
    assert.equal(isSilkBuffer(Buffer.alloc(0)), false);
    assert.equal(isSilkBuffer(Buffer.from('#!AMR\n')), false);
    assert.equal(isSilkBuffer(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(20, 0), Buffer.from('WAVE')])), false);
    assert.equal(isSilkBuffer(Buffer.from('xx')), false);
});

test('transcodeSilkBufferToMp3 把真实 SILK 转成非空 MP3 字节', async () => {
    const silk = await makeSilkSample(24000);
    const result = await transcodeSilkBufferToMp3(silk, { sampleRate: 24000, bitrateKbps: 64 });
    assert.ok(result, '应当返回 mp3 + 时长');
    assert.ok(result!.mp3.length > 0, 'mp3 字节流不能为空');
    // MP3：头几个字节要么是 ID3，要么是 0xFFE/F 的同步字。lamejs 默认裸帧无 ID3。
    const head = result!.mp3.subarray(0, 3);
    const looksLikeMp3 =
        (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) || // 'ID3'
        (head[0] === 0xff && (head[1] === 0xfb || head[1] === 0xf3 || head[1] === 0xf2 || head[1] === 0xfa));
    assert.equal(looksLikeMp3, true, `mp3 头不像 MP3 帧：${head[0].toString(16)} ${head[1].toString(16)} ${head[2].toString(16)}`);
    // 1 秒 64 kbps 估算 ~8 KiB，留足容差。
    assert.ok(result!.mp3.length >= 1024, `mp3 体积过小：${result!.mp3.length} bytes`);
});

test('transcodeSilkBufferToMp3 对非 SILK 输入返回 null', async () => {
    const fake = Buffer.from('not silk anyway');
    const result = await transcodeSilkBufferToMp3(fake, { silent: true });
    assert.equal(result, null);
});

test('transcodeSilkBufferToMp3 对空 buffer 返回 null', async () => {
    const result = await transcodeSilkBufferToMp3(Buffer.alloc(0), { silent: true });
    assert.equal(result, null);
});

test('transcodeSilkFileToMp3 写出 .mp3 文件并报告时长', async () => {
    const t = tmpDir('qce-silk-mp3-');
    try {
        const silkPath = path.join(t.dir, 'voice.silk');
        const mp3Path = path.join(t.dir, 'voice.mp3');
        fs.writeFileSync(silkPath, await makeSilkSample(24000));

        const result = await transcodeSilkFileToMp3(silkPath, mp3Path);
        assert.ok(result, '转码失败');
        assert.equal(result!.mp3Path, mp3Path);
        assert.ok(fs.existsSync(mp3Path));
        assert.ok(fs.statSync(mp3Path).size >= 1024);
        // silk-wasm 报告的 duration 单位是毫秒，1 秒 PCM 大约在 [600, 1400] 内（边界帧丢弃）。
        assert.ok(result!.durationMs >= 600 && result!.durationMs <= 1400,
            `时长不在合理区间：${result!.durationMs}ms`);
    } finally {
        t.cleanup();
    }
});

test('transcodeSilkFileToMp3 路径不存在返回 null（不抛）', async () => {
    const result = await transcodeSilkFileToMp3('/tmp/__qce_not_a_real_silk__', '/tmp/__qce_out__.mp3');
    assert.equal(result, null);
});

test('transcodeSilkFileToMp3 对内容是真 AMR 而非 SILK 的文件返回 null', async () => {
    const t = tmpDir('qce-silk-mp3-amr-');
    try {
        const amrPath = path.join(t.dir, 'fake.silk');
        fs.writeFileSync(amrPath, Buffer.concat([Buffer.from('#!AMR\n'), Buffer.alloc(64, 0x33)]));
        const result = await transcodeSilkFileToMp3(amrPath, path.join(t.dir, 'fake.mp3'));
        assert.equal(result, null);
        assert.equal(fs.existsSync(path.join(t.dir, 'fake.mp3')), false);
    } finally {
        t.cleanup();
    }
});
