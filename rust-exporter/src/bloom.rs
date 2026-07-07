//! Bloom Filter 与 FNV-1a 32 位哈希（对应 TS `ModernHtmlExporter.ts` 中
//! chunked 模式使用的实现）。
//!
//! 与 TS 的位级语义严格对齐：
//! - `fnv1a32` 按 UTF-16 码元（`charCodeAt`）逐个异或后乘 `0x01000193`（`Math.imul`
//!   的 32 位环绕乘法 = `wrapping_mul`）；
//! - Bloom 位下标使用 `(h1 + i * h2) % bits`，字节序 / 位序与 TS 相同，
//!   `to_base64` 输出可直接被前端 viewer 解码。

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;

/// FNV-1a 32 位哈希（对 UTF-16 码元逐个处理，等价于 JS `charCodeAt` 循环）。
#[must_use]
pub fn fnv1a32(s: &str, seed: u32) -> u32 {
    let mut h = if seed == 0 { 0x811c_9dc5 } else { seed };
    for unit in s.encode_utf16() {
        h ^= u32::from(unit);
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// FNV-1a 32 位哈希（直接消费 UTF-16 码元切片）。
///
/// TS 侧的 n-gram 建索引按 `String#slice` 的 UTF-16 码元切片，可能切断
/// 代理对；为保证 Bloom 输出与 TS 位级一致，这里提供直接对码元序列
/// 哈希的入口，避免中途经过 UTF-8 的有损转换。
#[must_use]
pub fn fnv1a32_utf16(units: &[u16], seed: u32) -> u32 {
    let mut h = if seed == 0 { 0x811c_9dc5 } else { seed };
    for &unit in units {
        h ^= u32::from(unit);
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

/// 简单 Bloom Filter（add-only，供全文搜索索引使用）。
pub struct BloomFilter {
    bits: u32,
    hashes: u32,
    bytes: Vec<u8>,
}

impl BloomFilter {
    /// 新建：`bits` 为位数，`hashes` 为哈希次数。
    #[must_use]
    pub fn new(bits: u32, hashes: u32) -> Self {
        let byte_len = (bits as usize).div_ceil(8);
        Self {
            bits,
            hashes,
            bytes: vec![0u8; byte_len],
        }
    }

    /// 加入一个 token（空串忽略，与 TS 一致）。
    pub fn add(&mut self, token: &str) {
        if token.is_empty() || self.bits == 0 {
            return;
        }
        let h1 = fnv1a32(token, 0x811c_9dc5);
        let h2 = fnv1a32(token, 0x811c_9dc5 ^ 0x5bd1_e995);
        for i in 0..self.hashes {
            let idx = (h1.wrapping_add(i.wrapping_mul(h2))) % self.bits;
            let byte_index = (idx >> 3) as usize;
            let mask = 1u8 << (idx & 7);
            self.bytes[byte_index] |= mask;
        }
    }

    /// 加入一个 UTF-16 码元序列 token（空序列忽略）。
    ///
    /// 与 [`fnv1a32_utf16`] 配套，供按 UTF-16 码元切片的 n-gram 使用。
    pub fn add_utf16(&mut self, units: &[u16]) {
        if units.is_empty() || self.bits == 0 {
            return;
        }
        let h1 = fnv1a32_utf16(units, 0x811c_9dc5);
        let h2 = fnv1a32_utf16(units, 0x811c_9dc5 ^ 0x5bd1_e995);
        for i in 0..self.hashes {
            let idx = (h1.wrapping_add(i.wrapping_mul(h2))) % self.bits;
            let byte_index = (idx >> 3) as usize;
            let mask = 1u8 << (idx & 7);
            self.bytes[byte_index] |= mask;
        }
    }

    /// 导出为 base64（与 `Buffer#toString('base64')` 输出一致）。
    #[must_use]
    pub fn to_base64(&self) -> String {
        BASE64.encode(&self.bytes)
    }
}
