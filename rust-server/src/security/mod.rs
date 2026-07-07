//! 安全管理（对应 TS `security/SecurityManager.ts`）。
//!
//! 负责认证 token 生成 / 校验、IP 白名单（精确 / CIDR / 通配符）、
//! Docker 环境探测与 security.json 的加载 / 迁移 / 热加载。

pub mod manager;

pub use manager::{SecurityManager, VerifyTokenReason, VerifyTokenResult};
