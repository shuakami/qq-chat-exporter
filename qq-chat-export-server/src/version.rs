use std::sync::OnceLock;

/// 应用名称（不带版本）。
const BASE_APP_NAME: &str = "QQChatExporter";

/// GitHub 仓库地址。
pub const GITHUB_URL: &str = "https://github.com/shuakami/qq-chat-exporter";

/// 版权声明。
pub const APP_COPYRIGHT: &str =
    "本软件是免费的开源项目~ 如果您是买来的，请立即退款！如果有帮助到您，欢迎给我点个Star~";

/// QCE 版本号：优先环境变量 `QCE_VERSION`（CI 构建时注入），否则用 crate 版本。
pub static VERSION: once_cell_version::Lazy = once_cell_version::Lazy;

/// 惰性版本号实现（无第三方 once_cell 依赖，基于 std `OnceLock`）。
pub mod once_cell_version {
    use super::OnceLock;

    /// 版本号惰性单元。
    pub struct Lazy;

    static VERSION_CELL: OnceLock<String> = OnceLock::new();

    impl Lazy {
        /// 取版本号字符串。
        pub fn get(&self) -> &'static str {
            VERSION_CELL.get_or_init(|| {
                std::env::var("QCE_VERSION")
                    .ok()
                    .filter(|v| !v.trim().is_empty())
                    .or_else(|| option_env!("QCE_VERSION").map(str::to_string))
                    .filter(|v| !v.trim().is_empty())
                    .map_or_else(
                        || env!("CARGO_PKG_VERSION").to_string(),
                        |v| v.trim().trim_start_matches('v').to_string(),
                    )
            })
        }
    }

    impl serde::Serialize for Lazy {
        fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            serializer.serialize_str(self.get())
        }
    }

    impl std::fmt::Display for Lazy {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "{}", self.get())
        }
    }
}

/// 主版本号。
#[must_use]
pub fn major_version() -> &'static str {
    VERSION.get().split('.').next().unwrap_or("5")
}

/// 完整应用名称（带版本 + GitHub 地址），对应 TS `APP_INFO.name`。
pub static APP_NAME: AppNameLazy = AppNameLazy;

/// APP_NAME 惰性单元。
pub struct AppNameLazy;

static APP_NAME_CELL: OnceLock<String> = OnceLock::new();

impl AppNameLazy {
    /// 取完整应用名称。
    pub fn get(&self) -> &'static str {
        APP_NAME_CELL
            .get_or_init(|| format!("{BASE_APP_NAME} V{} / {GITHUB_URL}", major_version()))
    }
}

impl serde::Serialize for AppNameLazy {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.get())
    }
}

impl std::fmt::Display for AppNameLazy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.get())
    }
}
