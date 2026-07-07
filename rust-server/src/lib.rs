//! QCE Rust 服务端库。
//!
//! 模块划分：
//! - [`parser`]：NapCat `RawMessage` → `CleanMessage` 解析（含回复预览、合并转发递归）。

pub mod api;
pub mod fetcher;
pub mod napcat;
pub mod parser;
pub mod paths;
pub mod progress;
pub mod resource;
pub mod scheduler;
pub mod security;
pub mod storage;
pub mod version;
