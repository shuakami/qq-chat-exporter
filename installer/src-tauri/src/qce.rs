//! QCE (QQ Chat Exporter) runtime helpers: detect the HTTP server, build the
//! one-click WebUI link from `security.json`, and open the log file.

use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::state::AppState;
use crate::util::{self, QCE_PORT};

fn log(state: &State<'_, AppState>, msg: &str) {
    if let Some(dir) = install_dir(state) {
        util::installer_log(&dir, msg);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningInfo {
    pub running: bool,
    pub webui_url: Option<String>,
}

fn install_dir(state: &State<'_, AppState>) -> Option<PathBuf> {
    state.0.lock().ok().and_then(|s| s.install_dir())
}

/// Read the QCE access token from `security.json`. Prefer the install-local
/// config dir (we pin it via `QCE_CONFIG_DIR`); fall back to the user profile.
fn read_access_token(state: &State<'_, AppState>) -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(dir) = install_dir(state) {
        candidates.push(util::qce_config_dir(&dir).join("security.json"));
    }
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".qq-chat-exporter").join("security.json"));
    }
    for path in &candidates {
        if let Ok(text) = std::fs::read_to_string(path) {
            if let Ok(json) = serde_json::from_str::<Value>(&text) {
                if let Some(tok) = json.get("accessToken").and_then(Value::as_str) {
                    if !tok.is_empty() {
                        return Some(tok.to_string());
                    }
                }
            }
        }
    }
    log(state, &format!("access token not found in {:?}", candidates));
    None
}

fn get_webui_url_inner(state: &State<'_, AppState>) -> Option<String> {
    let base = format!("http://127.0.0.1:{QCE_PORT}/qce");
    match read_access_token(state) {
        Some(token) => Some(format!("{base}/auth?token={}", urlencode(&token))),
        None => Some(base),
    }
}

#[tauri::command]
pub fn get_webui_url(state: State<'_, AppState>) -> Option<String> {
    get_webui_url_inner(&state)
}

#[tauri::command]
pub async fn qce_status(state: State<'_, AppState>) -> Result<RunningInfo, String> {
    let running = probe_qce().await;
    let webui_url = if running {
        // QCE's SecurityManager may still be writing security.json right
        // after the HTTP server starts.  Retry a few times so we don't
        // hand the frontend a URL without a token.
        let mut url = get_webui_url_inner(&state);
        if running && url.as_ref().map(|u| !u.contains("token=")).unwrap_or(true) {
            for _ in 0..4 {
                tokio::time::sleep(Duration::from_millis(500)).await;
                url = get_webui_url_inner(&state);
                if url.as_ref().map(|u| u.contains("token=")).unwrap_or(false) {
                    break;
                }
            }
        }
        if let Some(ref u) = url {
            log(&state, &format!("webui url: {u}"));
        }
        url
    } else {
        None
    };
    Ok(RunningInfo { running, webui_url })
}

async fn probe_qce() -> bool {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(1200))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    // The frontend route returns 200 once QCE is serving.
    client
        .get(format!("http://127.0.0.1:{QCE_PORT}/qce"))
        .send()
        .await
        .map(|r| r.status().is_success() || r.status().is_redirection())
        .unwrap_or(false)
}

#[tauri::command]
pub fn open_log_file(state: State<'_, AppState>) -> Result<(), String> {
    let dir = install_dir(&state).ok_or_else(|| "尚未安装".to_string())?;
    let log = util::log_file_path(&dir);
    if !log.exists() {
        if let Some(parent) = log.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&log, b"");
    }
    open_path(&log)
}

fn open_path(path: &std::path::Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        // 用记事本直接打开：`cmd /C start` 依赖文件关联，某些环境下会静默失败。
        std::process::Command::new("notepad")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .status()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .status()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
