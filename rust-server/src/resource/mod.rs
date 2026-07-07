//! 资源处理层：下载、健康检查、缓存管理与熔断。

pub mod circuit_breaker;
pub mod handler;
pub mod health;

pub use handler::{
    MediaDownloader, ResourceBatchSummary, ResourceHandler, ResourceHandlerConfig,
    ResourceProgress, ResourceProgressCallback, SilkTranscoder,
};
