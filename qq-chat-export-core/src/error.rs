use std::path::PathBuf;

/// 导出统一 Result 别名。
pub type ExportResultT<T> = Result<T, ExportError>;

/// 导出过程中的所有错误情形。
#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    /// I/O 错误（文件读写、目录创建等），附带出错路径与操作说明。
    #[error("{operation} 操作失败: {source} (path: {path})")]
    Io {
        /// 出错的操作名，例如 `writeToFile`。
        operation: &'static str,
        /// 相关路径。
        path: PathBuf,
        /// 底层 I/O 错误。
        #[source]
        source: std::io::Error,
    },

    /// JSON 序列化 / 反序列化失败。
    #[error("JSON 序列化失败: {0}")]
    Json(#[from] serde_json::Error),

    /// Excel 工作簿生成失败。
    #[error("Excel 生成失败: {0}")]
    Xlsx(#[from] rust_xlsxwriter::XlsxError),

    /// 导出被调用方取消。
    #[error("导出已取消")]
    Cancelled,

    /// chunked 输出目录冲突：路径已存在且不是目录。
    #[error("chunked 输出目录冲突：{0} 已存在且不是目录")]
    OutputDirConflict(PathBuf),

    /// 无效的导出配置。
    #[error("无效的导出配置: {0}")]
    InvalidOptions(String),

    /// 后台任务 join 失败（tokio 任务 panic 或被取消）。
    #[error("后台任务失败: {0}")]
    TaskJoin(#[from] tokio::task::JoinError),
}

impl ExportError {
    /// 构造带路径上下文的 I/O 错误。
    #[must_use]
    pub fn io(operation: &'static str, path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Self::Io {
            operation,
            path: path.into(),
            source,
        }
    }
}
