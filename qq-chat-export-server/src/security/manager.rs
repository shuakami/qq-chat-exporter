use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::Duration;

#[cfg(unix)]
use std::io::Write;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[cfg(unix)]
fn write_security_config(path: &Path, data: &str) -> std::io::Result<()> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(path)?;
    file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    file.write_all(data.as_bytes())
}

#[cfg(not(unix))]
fn write_security_config(path: &Path, data: &str) -> std::io::Result<()> {
    std::fs::write(path, data)
}

/// `security.json` 结构，字段序列化为 camelCase。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityConfig {
    /// 访问令牌（40 字符纯字母数字，issue #272）。
    #[serde(default)]
    pub access_token: String,
    /// 密钥（64 字符）。
    #[serde(default)]
    pub secret_key: String,
    /// 创建时间。
    #[serde(default)]
    pub created_at: Option<DateTime<Utc>>,
    /// 最后访问时间。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_access: Option<DateTime<Utc>>,
    /// IP 白名单（精确 IP / CIDR / `*`）。
    #[serde(default)]
    pub allowed_i_ps: Vec<String>,
    /// 令牌过期时间。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_expired: Option<DateTime<Utc>>,
    /// 用户配置的服务器地址，用于外网访问。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_host: Option<String>,
    /// 是否禁用 IP 白名单验证（Docker 环境下可能需要）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disable_ip_whitelist: Option<bool>,
}

/// verifyToken 失败原因（issue #438：三种失败拆开成可识别 reason）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerifyTokenReason {
    /// token 不匹配 / 配置缺失。
    InvalidToken,
    /// token 已过期。
    TokenExpired,
    /// token 正确，但 clientIP 不在白名单内。
    IpNotAllowed,
}

/// token 校验结果。
pub type VerifyTokenResult = Result<(), VerifyTokenReason>;

/// 检测是否在 Docker 环境中运行。
fn is_docker_environment() -> bool {
    if Path::new("/.dockerenv").exists() {
        return true;
    }
    if let Ok(cgroup) = std::fs::read_to_string("/proc/self/cgroup") {
        if cgroup.contains("docker") || cgroup.contains("kubepods") {
            return true;
        }
    }
    if std::env::var_os("container").is_some() || std::env::var_os("DOCKER_CONTAINER").is_some() {
        return true;
    }
    if let Ok(mountinfo) = std::fs::read_to_string("/proc/1/mountinfo") {
        if mountinfo.contains("docker") || mountinfo.contains("/containers/") {
            return true;
        }
    }
    false
}

/// 从 `/proc/net/route` 解析默认路由网关 IP（issue #438：Docker bridge SNAT 源）。
fn detect_docker_bridge_gateways() -> Vec<String> {
    if !cfg!(target_os = "linux") {
        return Vec::new();
    }
    let Ok(content) = std::fs::read_to_string("/proc/net/route") else {
        return Vec::new();
    };
    let mut gateways: Vec<String> = Vec::new();
    for line in content.lines().skip(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 8 {
            continue;
        }
        let destination = cols[1];
        let gateway_hex = cols[2];
        if destination != "00000000" || gateway_hex == "00000000" || gateway_hex.len() != 8 {
            continue;
        }
        let Ok(raw) = u32::from_str_radix(gateway_hex, 16) else {
            continue;
        };
        // `/proc/net/route` 中 gateway 是小端 hex：低字节在前。
        let bytes = raw.to_le_bytes();
        let ip = format!("{}.{}.{}.{}", bytes[3], bytes[2], bytes[1], bytes[0]);
        if ip != "0.0.0.0" && !gateways.contains(&ip) {
            gateways.push(ip);
        }
    }
    gateways
}

/// 解析 CIDR，返回 (网络地址, 掩码位数)。
fn parse_cidr(cidr: &str) -> Option<(u32, u32)> {
    let (ip_part, mask_part) = cidr.split_once('/')?;
    let mask_bits: u32 = mask_part.parse().ok()?;
    if mask_bits > 32 {
        return None;
    }
    Some((ip_to_number(ip_part)?, mask_bits))
}

/// IP 字符串 → u32（自动剥离 `::ffff:` 前缀）。
fn ip_to_number(ip: &str) -> Option<u32> {
    let clean = ip.strip_prefix("::ffff:").unwrap_or(ip);
    let parts: Vec<&str> = clean.split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    let mut result: u32 = 0;
    for part in parts {
        let num: u32 = part.parse().ok()?;
        if num > 255 {
            return None;
        }
        result = (result << 8) | num;
    }
    Some(result)
}

/// 检查 IP 是否匹配 CIDR 规则。
fn ip_matches_cidr(ip: &str, cidr: &str) -> bool {
    let Some((network, mask_bits)) = parse_cidr(cidr) else {
        return false;
    };
    let Some(ip_num) = ip_to_number(ip) else {
        return false;
    };
    let mask: u32 = if mask_bits == 0 {
        0
    } else {
        u32::MAX << (32 - mask_bits)
    };
    (ip_num & mask) == (network & mask)
}

/// 生成安全令牌（只用 A-Z / a-z / 0-9，issue #272）。
fn generate_secure_token(length: usize) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut result = String::with_capacity(length);
    let mut buf = vec![0u8; length];
    // getrandom 失败在任何受支持平台上都意味着系统级熵源损坏，无法安全继续。
    getrandom::getrandom(&mut buf).expect("系统随机数源不可用");
    for byte in buf {
        result.push(CHARS[(byte as usize) % CHARS.len()] as char);
    }
    result
}

/// 安全管理器。
#[derive(Debug)]
pub struct SecurityManager {
    config_path: PathBuf,
    config: RwLock<Option<SecurityConfig>>,
    public_ip: RwLock<Option<String>>,
    is_docker: bool,
    last_mtime: RwLock<Option<std::time::SystemTime>>,
}

impl SecurityManager {
    /// 创建安全管理器（配置目录见 [`Self::resolve_security_dir`]）。
    pub fn new() -> std::io::Result<Self> {
        let security_dir = Self::resolve_security_dir();
        std::fs::create_dir_all(&security_dir)?;
        Ok(Self {
            config_path: security_dir.join("security.json"),
            config: RwLock::new(None),
            public_ip: RwLock::new(None),
            is_docker: is_docker_environment(),
            last_mtime: RwLock::new(None),
        })
    }

    /// 计算 security.json 所在目录（issue #272 优先级）。
    #[must_use]
    pub fn resolve_security_dir() -> PathBuf {
        if let Some(env_override) = std::env::var_os("QCE_CONFIG_DIR") {
            let trimmed = env_override.to_string_lossy().trim().to_string();
            if !trimmed.is_empty() {
                return PathBuf::from(trimmed);
            }
        }

        let mut candidates: Vec<Option<String>> = vec![
            std::env::var("USERPROFILE").ok(),
            std::env::var("HOME").ok(),
        ];
        if let (Ok(drive), Ok(home_path)) = (std::env::var("HOMEDRIVE"), std::env::var("HOMEPATH"))
        {
            candidates.push(Some(format!("{drive}{home_path}")));
        }

        for candidate in candidates.into_iter().flatten() {
            if candidate.is_empty() {
                continue;
            }
            let normalized = candidate.replace('\\', "/").to_lowercase();
            // SYSTEM 账户 / system32 下不可写：跳过
            if normalized.contains("/windows/system32") || normalized.contains("/windows/syswow64")
            {
                continue;
            }
            return PathBuf::from(candidate).join(".qq-chat-exporter");
        }

        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(".qq-chat-exporter")
    }

    /// 初始化安全配置（加载或生成 + 出厂占位迁移 + serverHost 应用）。
    pub fn initialize(&self) {
        {
            let mut public_ip = self.public_ip.write().expect("public_ip 锁中毒");
            *public_ip = Some(
                if self.is_docker {
                    "0.0.0.0"
                } else {
                    "127.0.0.1"
                }
                .to_string(),
            );
        }

        tracing::info!(
            "[QCE][SecurityManager] config: {}",
            self.config_path.display()
        );

        if self.config_path.exists() {
            self.load_config();
            self.migrate_factory_config_if_needed();
        } else {
            self.generate_initial_config();
        }

        let server_host = {
            let guard = self.config.read().expect("config 锁中毒");
            guard.as_ref().and_then(|c| c.server_host.clone())
        };
        if let Some(host) = server_host {
            self.set_server_host(&host);
        }
        self.record_mtime();
    }

    /// 记录当前配置文件 mtime（热加载基线）。
    fn record_mtime(&self) {
        let mtime = std::fs::metadata(&self.config_path)
            .and_then(|m| m.modified())
            .ok();
        if let Ok(mut guard) = self.last_mtime.write() {
            *guard = mtime;
        }
    }

    /// 热加载检查：mtime 变化时重新加载配置（替代 TS 的 fs.watch，由外部定时调用）。
    pub fn poll_config_reload(&self) {
        let current = std::fs::metadata(&self.config_path)
            .and_then(|m| m.modified())
            .ok();
        let changed = {
            let guard = self.last_mtime.read().expect("last_mtime 锁中毒");
            *guard != current
        };
        if changed {
            self.load_config();
            self.record_mtime();
        }
    }

    /// 启动后台热加载任务（500ms 间隔轮询）。
    pub fn spawn_config_watcher(self: &std::sync::Arc<Self>) -> tokio::task::JoinHandle<()> {
        let manager = std::sync::Arc::clone(self);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(500));
            loop {
                interval.tick().await;
                manager.poll_config_reload();
            }
        })
    }

    /// Issue #438: 出厂占位 security.json 迁移。
    fn migrate_factory_config_if_needed(&self) {
        let mut guard = self.config.write().expect("config 锁中毒");
        let Some(cfg) = guard.as_mut() else {
            return;
        };

        let missing_core_fields =
            cfg.access_token.is_empty() || cfg.secret_key.is_empty() || cfg.created_at.is_none();
        if !missing_core_fields {
            return;
        }

        if cfg.access_token.is_empty() {
            cfg.access_token = generate_secure_token(40);
        }
        if cfg.secret_key.is_empty() {
            cfg.secret_key = generate_secure_token(64);
        }
        if cfg.created_at.is_none() {
            cfg.created_at = Some(Utc::now());
        }
        if cfg.token_expired.is_none() {
            cfg.token_expired = Some(Utc::now() + chrono::Duration::days(7));
        }
        if cfg.allowed_i_ps.is_empty() {
            cfg.allowed_i_ps = vec!["127.0.0.1".to_string(), "::1".to_string()];
        }

        if self.is_docker {
            for entry in [
                "127.0.0.1",
                "::1",
                "172.16.0.0/12",
                "192.168.0.0/16",
                "10.0.0.0/8",
            ] {
                if !cfg.allowed_i_ps.iter().any(|ip| ip == entry) {
                    cfg.allowed_i_ps.push(entry.to_string());
                }
            }
            for gw in detect_docker_bridge_gateways() {
                if !cfg.allowed_i_ps.contains(&gw) {
                    cfg.allowed_i_ps.push(gw);
                }
            }
            cfg.disable_ip_whitelist = Some(true);
            tracing::info!(
                "[QCE][SecurityManager] Detected factory-shipped security.json in Docker, auto-enabling Docker-friendly auth (issue #438)."
            );
        }

        let snapshot = cfg.clone();
        drop(guard);
        self.save_config_snapshot(&snapshot);
    }

    /// 设置服务器地址。
    pub fn set_server_host(&self, host: &str) {
        let value = if host == "0.0.0.0" || host.is_empty() {
            "127.0.0.1".to_string()
        } else {
            host.to_string()
        };
        if let Ok(mut guard) = self.public_ip.write() {
            *guard = Some(value);
        }
    }

    /// 更新服务器地址配置并保存。
    pub fn update_server_host(&self, host: &str) {
        let snapshot = {
            let mut guard = self.config.write().expect("config 锁中毒");
            let Some(cfg) = guard.as_mut() else { return };
            cfg.server_host = Some(host.to_string());
            cfg.clone()
        };
        self.save_config_snapshot(&snapshot);
        self.set_server_host(host);
    }

    /// 生成初始安全配置。
    fn generate_initial_config(&self) {
        let mut allowed = vec!["127.0.0.1".to_string(), "::1".to_string()];
        if self.is_docker {
            allowed.push("172.16.0.0/12".to_string());
            allowed.push("192.168.0.0/16".to_string());
            allowed.push("10.0.0.0/8".to_string());
            for gw in detect_docker_bridge_gateways() {
                if !allowed.contains(&gw) {
                    allowed.push(gw);
                }
            }
        }
        let config = SecurityConfig {
            access_token: generate_secure_token(40),
            secret_key: generate_secure_token(64),
            created_at: Some(Utc::now()),
            last_access: None,
            allowed_i_ps: allowed,
            token_expired: Some(Utc::now() + chrono::Duration::days(7)),
            server_host: None,
            disable_ip_whitelist: Some(self.is_docker),
        };
        self.save_config_snapshot(&config);
        let mut guard = self.config.write().expect("config 锁中毒");
        *guard = Some(config);
    }

    /// 加载安全配置（解析失败时重新生成）。
    fn load_config(&self) {
        let parsed: Option<SecurityConfig> = std::fs::read_to_string(&self.config_path)
            .ok()
            .and_then(|data| serde_json::from_str(&data).ok());
        match parsed {
            Some(config) => {
                let expired = config
                    .token_expired
                    .is_some_and(|expiry| Utc::now() > expiry);
                {
                    let mut guard = self.config.write().expect("config 锁中毒");
                    *guard = Some(config);
                }
                if expired {
                    self.regenerate_token();
                }
            }
            None => self.generate_initial_config(),
        }
    }

    /// 保存安全配置快照到磁盘。
    fn save_config_snapshot(&self, config: &SecurityConfig) {
        if let Ok(data) = serde_json::to_string_pretty(config) {
            if write_security_config(&self.config_path, &data).is_err() {
                tracing::warn!("[QCE][SecurityManager] security.json 写入失败");
            }
        }
        self.record_mtime();
    }

    /// 重新生成访问令牌。
    fn regenerate_token(&self) {
        let snapshot = {
            let mut guard = self.config.write().expect("config 锁中毒");
            let Some(cfg) = guard.as_mut() else { return };
            cfg.access_token = generate_secure_token(40);
            cfg.token_expired = Some(Utc::now() + chrono::Duration::days(7));
            cfg.clone()
        };
        self.save_config_snapshot(&snapshot);
    }

    /// 验证访问令牌（兼容旧调用，返回布尔值）。
    pub fn verify_token(&self, token: &str, client_ip: Option<&str>) -> bool {
        self.verify_token_with_reason(token, client_ip).is_ok()
    }

    /// 验证访问令牌，返回带具体失败原因的结果（issue #438）。
    pub fn verify_token_with_reason(
        &self,
        token: &str,
        client_ip: Option<&str>,
    ) -> VerifyTokenResult {
        let snapshot = {
            let guard = self.config.read().expect("config 锁中毒");
            guard.clone()
        };
        let Some(cfg) = snapshot else {
            return Err(VerifyTokenReason::InvalidToken);
        };
        if cfg.access_token.is_empty() || token != cfg.access_token {
            return Err(VerifyTokenReason::InvalidToken);
        }
        if cfg.token_expired.is_some_and(|expiry| Utc::now() > expiry) {
            return Err(VerifyTokenReason::TokenExpired);
        }
        if !cfg.disable_ip_whitelist.unwrap_or(false) && !cfg.allowed_i_ps.is_empty() {
            let Some(ip) = client_ip else {
                return Err(VerifyTokenReason::IpNotAllowed);
            };
            if !Self::check_ip_allowed(&cfg, ip) {
                return Err(VerifyTokenReason::IpNotAllowed);
            }
        }

        // 更新最后访问时间
        let updated = {
            let mut guard = self.config.write().expect("config 锁中毒");
            if let Some(current) = guard.as_mut() {
                current.last_access = Some(Utc::now());
                Some(current.clone())
            } else {
                None
            }
        };
        if let Some(snapshot) = updated {
            self.save_config_snapshot(&snapshot);
        }
        Ok(())
    }

    /// 检查 IP 是否在白名单中（精确 / CIDR / 通配符）。
    fn check_ip_allowed(cfg: &SecurityConfig, client_ip: &str) -> bool {
        let clean_ip = client_ip.strip_prefix("::ffff:").unwrap_or(client_ip);
        for allowed in &cfg.allowed_i_ps {
            if allowed == "0.0.0.0" || allowed == "*" {
                return true;
            }
            if allowed.contains('/') {
                if ip_matches_cidr(clean_ip, allowed) {
                    return true;
                }
                continue;
            }
            if allowed == clean_ip || allowed == client_ip {
                return true;
            }
        }
        false
    }

    /// 获取访问令牌（仅用于显示）。
    pub fn access_token(&self) -> Option<String> {
        let guard = self.config.read().expect("config 锁中毒");
        guard
            .as_ref()
            .filter(|c| !c.access_token.is_empty())
            .map(|c| c.access_token.clone())
    }

    /// 获取服务器地址。
    pub fn public_ip(&self) -> Option<String> {
        self.public_ip.read().expect("public_ip 锁中毒").clone()
    }

    /// 获取安全状态信息。
    pub fn security_status(&self) -> serde_json::Value {
        let guard = self.config.read().expect("config 锁中毒");
        let cfg = guard.as_ref();
        serde_json::json!({
            "hasConfig": cfg.is_some(),
            "tokenExpired": cfg
                .and_then(|c| c.token_expired)
                .is_some_and(|expiry| Utc::now() > expiry),
            "publicIP": self.public_ip(),
            "createdAt": cfg.and_then(|c| c.created_at),
            "lastAccess": cfg.and_then(|c| c.last_access),
        })
    }

    /// 添加 IP 到白名单。
    pub fn add_allowed_ip(&self, ip: &str) {
        let snapshot = {
            let mut guard = self.config.write().expect("config 锁中毒");
            let Some(cfg) = guard.as_mut() else { return };
            if cfg.allowed_i_ps.iter().any(|existing| existing == ip) {
                return;
            }
            cfg.allowed_i_ps.push(ip.to_string());
            cfg.clone()
        };
        self.save_config_snapshot(&snapshot);
    }

    /// 从白名单移除 IP。
    pub fn remove_allowed_ip(&self, ip: &str) -> bool {
        let snapshot = {
            let mut guard = self.config.write().expect("config 锁中毒");
            let Some(cfg) = guard.as_mut() else {
                return false;
            };
            let Some(index) = cfg.allowed_i_ps.iter().position(|existing| existing == ip) else {
                return false;
            };
            cfg.allowed_i_ps.remove(index);
            cfg.clone()
        };
        self.save_config_snapshot(&snapshot);
        true
    }

    /// 获取当前白名单列表。
    pub fn allowed_ips(&self) -> Vec<String> {
        let guard = self.config.read().expect("config 锁中毒");
        guard
            .as_ref()
            .map(|c| c.allowed_i_ps.clone())
            .unwrap_or_default()
    }

    /// 设置是否禁用 IP 白名单验证。
    pub fn set_disable_ip_whitelist(&self, disable: bool) {
        let snapshot = {
            let mut guard = self.config.write().expect("config 锁中毒");
            let Some(cfg) = guard.as_mut() else { return };
            cfg.disable_ip_whitelist = Some(disable);
            cfg.clone()
        };
        self.save_config_snapshot(&snapshot);
    }

    /// 获取 IP 白名单是否禁用。
    pub fn is_ip_whitelist_disabled(&self) -> bool {
        let guard = self.config.read().expect("config 锁中毒");
        guard
            .as_ref()
            .and_then(|c| c.disable_ip_whitelist)
            .unwrap_or(false)
    }

    /// 检查是否在 Docker 环境中。
    pub fn is_in_docker(&self) -> bool {
        self.is_docker
    }

    /// 获取配置文件路径。
    pub fn config_path(&self) -> &Path {
        &self.config_path
    }

    /// 手动生成新的访问令牌。
    pub fn generate_new_token(&self) -> Option<String> {
        {
            let guard = self.config.read().expect("config 锁中毒");
            guard.as_ref()?;
        }
        self.regenerate_token();
        self.access_token()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cidr_matching() {
        assert!(ip_matches_cidr("172.17.0.1", "172.16.0.0/12"));
        assert!(ip_matches_cidr("192.168.1.20", "192.168.0.0/16"));
        assert!(!ip_matches_cidr("8.8.8.8", "10.0.0.0/8"));
        assert!(ip_matches_cidr("::ffff:10.1.2.3", "10.0.0.0/8"));
        assert!(!ip_matches_cidr("bad-ip", "10.0.0.0/8"));
        assert!(!ip_matches_cidr("10.0.0.1", "10.0.0.0/40"));
    }

    #[test]
    fn token_generation_charset() {
        let token = generate_secure_token(40);
        assert_eq!(token.len(), 40);
        assert!(token.chars().all(|c| c.is_ascii_alphanumeric()));
    }
}
