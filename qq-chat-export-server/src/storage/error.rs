use thiserror::Error;

/// 数据库错误（对应 TS `SystemError` 的 `DATABASE_ERROR` 分支）。
#[derive(Debug, Error)]
pub enum DatabaseError {
    /// 文件 I/O 失败。
    #[error("数据库 I/O 失败: {0}")]
    Io(#[from] std::io::Error),
    /// JSON 序列化 / 反序列化失败。
    #[error("数据库 JSON 解析失败: {0}")]
    Json(#[from] serde_json::Error),
    /// 记录内容非法。
    #[error("数据库记录非法: {0}")]
    InvalidRecord(String),
}
