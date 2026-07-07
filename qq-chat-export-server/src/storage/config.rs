use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::{watch, Mutex};

/// 配置文件名。
const CONFIG_FILE_NAME: &str = "config.json";
/// 用户配置文件名。
const USER_CONFIG_FILE_NAME: &str = "user-config.json";
/// 热重载轮询间隔（毫秒）。
const WATCH_POLL_INTERVAL_MS: u64 = 1000;

/// 配置错误。
#[derive(Debug, Error)]
pub enum ConfigError {
    /// 文件 I/O 失败。
    #[error("配置 I/O 失败: {0}")]
    Io(#[from] std::io::Error),
    /// JSON 解析失败。
    #[error("配置 JSON 解析失败: {0}")]
    Json(#[from] serde_json::Error),
    /// 配置验证失败。
    #[error("配置验证失败: {0}")]
    Validation(String),
}

/// 系统配置（对应 TS `SystemConfig`）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SystemConfig {
    /// 数据库路径。
    pub database_path: String,
    /// 导出根目录。
    pub output_root_dir: String,
    /// 默认批量大小。
    pub default_batch_size: i64,
    /// 默认超时（毫秒）。
    pub default_timeout: i64,
    /// 默认重试次数。
    pub default_retry_count: i64,
    /// 最大并发任务数。
    pub max_concurrent_tasks: i64,
    /// 资源健康检查间隔（毫秒）。
    pub resource_health_check_interval: i64,
    /// 是否启用调试日志。
    pub enable_debug_log: bool,
    /// WebUI 端口。
    pub webui_port: i64,
}

impl Default for SystemConfig {
    fn default() -> Self {
        let home = home_dir();
        Self {
            database_path: home
                .join(".qq-chat-exporter")
                .join("database.db")
                .to_string_lossy()
                .into_owned(),
            output_root_dir: home
                .join(".qq-chat-exporter")
                .join("exports")
                .to_string_lossy()
                .into_owned(),
            default_batch_size: 5000,
            default_timeout: 30000,
            default_retry_count: 3,
            max_concurrent_tasks: 3,
            resource_health_check_interval: 60000,
            enable_debug_log: false,
            webui_port: 8080,
        }
    }
}

/// 用户配置（对应 TS `UserConfig`）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UserConfig {
    /// 偏好导出格式。
    pub preferred_formats: Vec<String>,
    /// 自定义输出目录。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_output_dir: Option<String>,
    /// 自定义批量大小。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_batch_size: Option<i64>,
    /// 是否自动备份。
    pub auto_backup: bool,
    /// 备份保留天数。
    pub backup_retention_days: i64,
    /// 主题（light / dark / auto）。
    pub theme: String,
    /// 语言（zh-CN / en-US）。
    pub language: String,
    /// 是否显示高级选项。
    pub show_advanced_options: bool,
    /// 资源链接处理策略（keep / download / placeholder）。
    pub resource_link_strategy: String,
    /// 是否包含系统消息。
    pub include_system_messages: bool,
    /// 是否过滤纯多媒体消息。
    pub filter_pure_image_messages: bool,
    /// 是否启用通知。
    pub enable_notifications: bool,
    /// WebUI 访问密码。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webui_password: Option<String>,
}

impl Default for UserConfig {
    fn default() -> Self {
        Self {
            preferred_formats: vec!["html".to_string(), "json".to_string()],
            custom_output_dir: None,
            custom_batch_size: None,
            auto_backup: true,
            backup_retention_days: 7,
            theme: "auto".to_string(),
            language: "zh-CN".to_string(),
            show_advanced_options: false,
            resource_link_strategy: "keep".to_string(),
            include_system_messages: true,
            filter_pure_image_messages: false,
            enable_notifications: true,
            webui_password: None,
        }
    }
}

/// 合并后的完整配置。
#[derive(Debug, Clone)]
pub struct FullConfig {
    /// 系统配置。
    pub system: SystemConfig,
    /// 用户配置。
    pub user: UserConfig,
}

/// 内部可变状态。
#[derive(Debug)]
struct ConfigState {
    system: SystemConfig,
    user: UserConfig,
}

/// 配置管理器。
#[derive(Debug)]
pub struct ConfigManager {
    config_dir: PathBuf,
    system_config_path: PathBuf,
    user_config_path: PathBuf,
    state: Mutex<ConfigState>,
    change_tx: watch::Sender<FullConfig>,
    watch_handle: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl ConfigManager {
    /// 创建管理器。`config_dir` 为空时使用 `~/.qq-chat-exporter`。
    #[must_use]
    pub fn new(config_dir: Option<PathBuf>) -> Self {
        let config_dir = config_dir.unwrap_or_else(|| home_dir().join(".qq-chat-exporter"));
        let system_config_path = config_dir.join(CONFIG_FILE_NAME);
        let user_config_path = config_dir.join(USER_CONFIG_FILE_NAME);
        let state = ConfigState {
            system: SystemConfig::default(),
            user: UserConfig::default(),
        };
        let (change_tx, _) = watch::channel(FullConfig {
            system: state.system.clone(),
            user: state.user.clone(),
        });
        Self {
            config_dir,
            system_config_path,
            user_config_path,
            state: Mutex::new(state),
            change_tx,
            watch_handle: Mutex::new(None),
        }
    }

    /// 初始化：建目录、加载配置、环境变量覆盖、验证、启动热重载、建必要目录。
    pub async fn initialize(self: &Arc<Self>) -> Result<(), ConfigError> {
        tokio::fs::create_dir_all(&self.config_dir).await?;

        self.load_system_config().await?;
        self.load_user_config().await?;

        {
            let mut state = self.state.lock().await;
            apply_environment_overrides(&mut state.system);
            validate_config(&state.system, &state.user)?;
        }

        self.spawn_config_watcher().await;
        self.ensure_required_directories().await;
        Ok(())
    }

    /// 加载系统配置（缺失或损坏时回写默认配置）。
    async fn load_system_config(&self) -> Result<(), ConfigError> {
        let loaded = match tokio::fs::read_to_string(&self.system_config_path).await {
            Ok(content) => serde_json::from_str::<SystemConfig>(&content).ok(),
            Err(_) => None,
        };
        let mut state = self.state.lock().await;
        match loaded {
            Some(config) => {
                state.system = config;
                Ok(())
            }
            None => {
                state.system = SystemConfig::default();
                drop(state);
                self.save_system_config().await
            }
        }
    }

    /// 加载用户配置（缺失或损坏时回写默认配置）。
    async fn load_user_config(&self) -> Result<(), ConfigError> {
        let loaded = match tokio::fs::read_to_string(&self.user_config_path).await {
            Ok(content) => serde_json::from_str::<UserConfig>(&content).ok(),
            Err(_) => None,
        };
        let mut state = self.state.lock().await;
        match loaded {
            Some(config) => {
                state.user = config;
                Ok(())
            }
            None => {
                state.user = UserConfig::default();
                drop(state);
                self.save_user_config().await
            }
        }
    }

    /// 保存系统配置。
    pub async fn save_system_config(&self) -> Result<(), ConfigError> {
        let content = {
            let state = self.state.lock().await;
            serde_json::to_string_pretty(&state.system)?
        };
        tokio::fs::write(&self.system_config_path, content).await?;
        Ok(())
    }

    /// 保存用户配置。
    pub async fn save_user_config(&self) -> Result<(), ConfigError> {
        let content = {
            let state = self.state.lock().await;
            serde_json::to_string_pretty(&state.user)?
        };
        tokio::fs::write(&self.user_config_path, content).await?;
        Ok(())
    }

    /// 获取合并后的完整配置。
    pub async fn get_config(&self) -> FullConfig {
        let state = self.state.lock().await;
        FullConfig {
            system: state.system.clone(),
            user: state.user.clone(),
        }
    }

    /// 获取系统配置。
    pub async fn get_system_config(&self) -> SystemConfig {
        self.state.lock().await.system.clone()
    }

    /// 获取用户配置。
    pub async fn get_user_config(&self) -> UserConfig {
        self.state.lock().await.user.clone()
    }

    /// 更新系统配置（验证失败时回滚）。
    pub async fn update_system_config(
        &self,
        updates: &serde_json::Value,
    ) -> Result<(), ConfigError> {
        {
            let mut state = self.state.lock().await;
            let merged = merge_json(&serde_json::to_value(&state.system)?, updates);
            let candidate: SystemConfig = serde_json::from_value(merged)?;
            validate_config(&candidate, &state.user)?;
            state.system = candidate;
        }
        self.save_system_config().await?;
        self.notify_config_change().await;
        Ok(())
    }

    /// 更新用户配置（验证失败时回滚）。
    pub async fn update_user_config(&self, updates: &serde_json::Value) -> Result<(), ConfigError> {
        {
            let mut state = self.state.lock().await;
            let merged = merge_json(&serde_json::to_value(&state.user)?, updates);
            let candidate: UserConfig = serde_json::from_value(merged)?;
            validate_config(&state.system, &candidate)?;
            state.user = candidate;
        }
        self.save_user_config().await?;
        self.notify_config_change().await;
        Ok(())
    }

    /// 重置为默认配置。
    pub async fn reset_to_defaults(&self) -> Result<(), ConfigError> {
        {
            let mut state = self.state.lock().await;
            state.system = SystemConfig::default();
            state.user = UserConfig::default();
        }
        self.save_system_config().await?;
        self.save_user_config().await?;
        self.notify_config_change().await;
        Ok(())
    }

    /// 订阅配置变更。
    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<FullConfig> {
        self.change_tx.subscribe()
    }

    /// 获取配置路径信息。
    #[must_use]
    pub fn config_paths(&self) -> (PathBuf, PathBuf, PathBuf) {
        (
            self.config_dir.clone(),
            self.system_config_path.clone(),
            self.user_config_path.clone(),
        )
    }

    /// 广播配置变更。
    async fn notify_config_change(&self) {
        let config = self.get_config().await;
        let _ = self.change_tx.send(config);
    }

    /// 启动 mtime 轮询热重载任务。
    async fn spawn_config_watcher(self: &Arc<Self>) {
        let mut handle_guard = self.watch_handle.lock().await;
        if let Some(handle) = handle_guard.take() {
            handle.abort();
        }
        let manager = Arc::clone(self);
        *handle_guard = Some(tokio::spawn(async move {
            let mut last_system = file_mtime(&manager.system_config_path).await;
            let mut last_user = file_mtime(&manager.user_config_path).await;
            let mut interval = tokio::time::interval(std::time::Duration::from_millis(
                WATCH_POLL_INTERVAL_MS,
            ));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                interval.tick().await;
                let system_mtime = file_mtime(&manager.system_config_path).await;
                let user_mtime = file_mtime(&manager.user_config_path).await;
                let mut changed = false;
                if system_mtime != last_system {
                    last_system = system_mtime;
                    if manager.load_system_config().await.is_ok() {
                        changed = true;
                    }
                }
                if user_mtime != last_user {
                    last_user = user_mtime;
                    if manager.load_user_config().await.is_ok() {
                        changed = true;
                    }
                }
                if changed {
                    let valid = {
                        let state = manager.state.lock().await;
                        validate_config(&state.system, &state.user).is_ok()
                    };
                    if valid {
                        manager.notify_config_change().await;
                    } else {
                        tracing::error!("配置文件变更处理失败: 验证未通过");
                    }
                }
            }
        }));
    }

    /// 确保数据库目录、输出目录、自定义输出目录存在。
    async fn ensure_required_directories(&self) {
        let (database_path, output_root_dir, custom_output_dir) = {
            let state = self.state.lock().await;
            (
                state.system.database_path.clone(),
                state.system.output_root_dir.clone(),
                state.user.custom_output_dir.clone(),
            )
        };
        let mut dirs: Vec<PathBuf> = Vec::new();
        if let Some(parent) = Path::new(&database_path).parent() {
            dirs.push(parent.to_path_buf());
        }
        dirs.push(PathBuf::from(&output_root_dir));
        if let Some(custom) = custom_output_dir {
            if !custom.is_empty() {
                dirs.push(PathBuf::from(custom));
            }
        }
        for dir in dirs {
            if let Err(error) = tokio::fs::create_dir_all(&dir).await {
                tracing::warn!("创建目录失败: {} - {error}", dir.display());
            }
        }
    }

    /// 停止热重载任务。
    pub async fn dispose(&self) {
        if let Some(handle) = self.watch_handle.lock().await.take() {
            handle.abort();
        }
    }
}

/// 应用环境变量覆盖（对应 TS `applyEnvironmentOverrides`）。
fn apply_environment_overrides(config: &mut SystemConfig) {
    if let Ok(value) = std::env::var("QCE_DATABASE_PATH") {
        config.database_path = value;
    }
    if let Ok(value) = std::env::var("QCE_OUTPUT_DIR") {
        config.output_root_dir = value;
    }
    apply_int_env("QCE_BATCH_SIZE", &mut config.default_batch_size);
    apply_int_env("QCE_TIMEOUT", &mut config.default_timeout);
    apply_int_env("QCE_RETRY_COUNT", &mut config.default_retry_count);
    apply_int_env("QCE_MAX_CONCURRENT_TASKS", &mut config.max_concurrent_tasks);
    if let Ok(value) = std::env::var("QCE_DEBUG_LOG") {
        config.enable_debug_log = value.to_lowercase() == "true";
    }
    apply_int_env("QCE_WEBUI_PORT", &mut config.webui_port);
}

/// 解析整数环境变量并覆盖目标字段（无效时告警跳过）。
fn apply_int_env(name: &str, target: &mut i64) {
    if let Ok(value) = std::env::var(name) {
        match value.parse::<i64>() {
            Ok(parsed) => *target = parsed,
            Err(_) => tracing::warn!("环境变量 {name} 的值无效: {value}"),
        }
    }
}

/// 验证配置（对应 TS `validateConfig`）。
fn validate_config(system: &SystemConfig, user: &UserConfig) -> Result<(), ConfigError> {
    if system.default_batch_size <= 0 || system.default_batch_size > 50000 {
        return Err(ConfigError::Validation(
            "批量大小必须是1到50000之间的整数".to_string(),
        ));
    }
    if system.default_timeout < 1000 || system.default_timeout > 300_000 {
        return Err(ConfigError::Validation(
            "超时时间必须是1000到300000毫秒之间的整数".to_string(),
        ));
    }
    if system.default_retry_count < 0 || system.default_retry_count > 10 {
        return Err(ConfigError::Validation(
            "重试次数必须是0到10之间的整数".to_string(),
        ));
    }
    if system.max_concurrent_tasks < 1 || system.max_concurrent_tasks > 10 {
        return Err(ConfigError::Validation(
            "最大并发任务数必须是1到10之间的整数".to_string(),
        ));
    }
    if system.webui_port < 1024 || system.webui_port > 65535 {
        return Err(ConfigError::Validation(
            "WebUI端口必须是1024到65535之间的整数".to_string(),
        ));
    }
    if user.backup_retention_days < 1 || user.backup_retention_days > 365 {
        return Err(ConfigError::Validation(
            "备份保留天数必须是1到365之间的整数".to_string(),
        ));
    }
    Ok(())
}

/// 浅合并两个 JSON 对象（`updates` 覆盖 `base` 的顶层字段）。
fn merge_json(base: &serde_json::Value, updates: &serde_json::Value) -> serde_json::Value {
    let mut merged = base.clone();
    if let (Some(merged_obj), Some(updates_obj)) = (merged.as_object_mut(), updates.as_object()) {
        for (key, value) in updates_obj {
            merged_obj.insert(key.clone(), value.clone());
        }
    }
    merged
}

/// 获取文件修改时间（不存在时返回 None）。
async fn file_mtime(path: &Path) -> Option<std::time::SystemTime> {
    tokio::fs::metadata(path).await.ok()?.modified().ok()
}

/// 获取用户主目录（对应 Node `os.homedir()`）。
fn home_dir() -> PathBuf {
    #[cfg(windows)]
    let var = std::env::var("USERPROFILE");
    #[cfg(not(windows))]
    let var = std::env::var("HOME");
    var.map_or_else(|_| PathBuf::from("."), PathBuf::from)
}
