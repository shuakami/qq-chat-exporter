use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;
use crate::util;

const REPO: &str = "shuakami/qq-chat-exporter";
const SHELL_ASSET_PREFIX: &str = "NapCat-QCE-Windows-x64";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOptions {
    pub install_path: String,
    pub create_shortcut: bool,
    pub auto_start: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub percent: f64,
    pub message: String,
    pub phase: String,
}

fn emit(app: &AppHandle, event: &str, percent: f64, message: impl Into<String>, phase: &str) {
    let _ = app.emit(
        event,
        Progress {
            percent,
            message: message.into(),
            phase: phase.to_string(),
        },
    );
}

#[derive(Serialize)]
pub struct ValidateResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub fn get_default_install_dir() -> String {
    // Program Files on Windows; a sensible home fallback elsewhere.
    #[cfg(windows)]
    {
        if let Some(pf) = std::env::var_os("ProgramFiles") {
            return Path::new(&pf)
                .join("QQChatExporter")
                .to_string_lossy()
                .into_owned();
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("QQChatExporter")
        .to_string_lossy()
        .into_owned()
}

#[tauri::command]
pub fn get_free_space(dir: String) -> u64 {
    // Walk up to the first existing ancestor so a not-yet-created target dir
    // still reports the free space of the volume it will live on.
    let mut path = PathBuf::from(&dir);
    loop {
        if path.exists() {
            return fs2::available_space(&path).unwrap_or(0);
        }
        match path.parent() {
            Some(parent) => path = parent.to_path_buf(),
            None => return 0,
        }
    }
}

#[tauri::command]
pub fn validate_install_dir(dir: String) -> ValidateResult {
    let path = PathBuf::from(&dir);
    if dir.trim().is_empty() {
        return ValidateResult { ok: false, error: Some("路径为空".into()) };
    }
    // Require at least 2 GiB free on the target volume.
    let free = get_free_space(dir.clone());
    if free < 2 * 1024 * 1024 * 1024 {
        return ValidateResult {
            ok: false,
            error: Some("磁盘可用空间不足 2GB".into()),
        };
    }
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            return ValidateResult { ok: false, error: Some("上级目录不存在".into()) };
        }
    }
    ValidateResult { ok: true, error: None }
}

#[tauri::command]
pub async fn start_install(
    app: AppHandle,
    state: State<'_, AppState>,
    options: InstallOptions,
) -> Result<(), String> {
    let install_dir = PathBuf::from(&options.install_path);
    std::fs::create_dir_all(&install_dir).map_err(|e| format!("创建安装目录失败：{e}"))?;

    // The release build appends the full Shell package to the end of this exe,
    // so a normal run is a single self-contained file with no network download.
    // If no payload is present (e.g. a dev build), fall back to fetching it.
    if has_embedded_payload() {
        emit(&app, "install-progress", 5.0, "正在展开内置组件...", "Extracting");
        let extract_dir = install_dir.clone();
        let app_clone = app.clone();
        tokio::task::spawn_blocking(move || {
            let mut archive = embedded_shell_archive()
                .ok_or_else(|| anyhow::anyhow!("内置安装包读取失败"))?;
            extract_archive(&app_clone, &mut archive, &extract_dir)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("解压失败：{e}"))?;
    } else {
        emit(&app, "install-progress", 2.0, "正在获取最新版本信息...", "Downloading");
        let asset = resolve_shell_asset().await.map_err(|e| e.to_string())?;

        let tmp_zip = install_dir.join("_qce_shell.zip");
        download_with_progress(&app, &asset.url, &tmp_zip)
            .await
            .map_err(|e| format!("下载失败：{e}"))?;

        emit(&app, "install-progress", 70.0, "正在解压核心组件...", "Extracting");
        let extract_dir = install_dir.clone();
        let zip_path = tmp_zip.clone();
        let app_clone = app.clone();
        tokio::task::spawn_blocking(move || extract_zip_flat(&app_clone, &zip_path, &extract_dir))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| format!("解压失败：{e}"))?;
        let _ = std::fs::remove_file(&tmp_zip);
    }

    // --- post-install configuration --------------------------------------
    emit(&app, "install-progress", 92.0, "正在写入配置...", "Configuring");
    write_runtime_config(&install_dir, &state).map_err(|e| e.to_string())?;

    if options.create_shortcut {
        let _ = create_desktop_shortcut(&install_dir);
    }
    if options.auto_start {
        let _ = set_auto_start(&install_dir, true);
    }

    // Remember where we installed for later launch commands.
    {
        let mut inner = state.0.lock().map_err(|_| "state poisoned".to_string())?;
        inner.install_dir = Some(install_dir.clone());
    }

    emit(&app, "install-progress", 100.0, "安装完成", "Done");
    Ok(())
}

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

struct ShellAsset {
    url: String,
}

async fn resolve_shell_asset() -> anyhow::Result<ShellAsset> {
    #[derive(Deserialize)]
    struct Release {
        assets: Vec<Asset>,
    }
    #[derive(Deserialize)]
    struct Asset {
        name: String,
        browser_download_url: String,
    }

    let client = reqwest::Client::builder()
        .user_agent("qce-installer")
        .build()?;
    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let rel: Release = client.get(url).send().await?.error_for_status()?.json().await?;

    let asset = rel
        .assets
        .into_iter()
        .find(|a| a.name.starts_with(SHELL_ASSET_PREFIX) && a.name.ends_with(".zip"))
        .ok_or_else(|| anyhow::anyhow!("未在最新 Release 中找到 Windows Shell 包"))?;
    Ok(ShellAsset { url: asset.browser_download_url })
}

async fn download_with_progress(app: &AppHandle, url: &str, dest: &Path) -> anyhow::Result<()> {
    use futures_util::StreamExt;
    let client = reqwest::Client::builder().user_agent("qce-installer").build()?;
    let resp = client.get(url).send().await?.error_for_status()?;
    let total = resp.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(dest)?;
    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;
        let pct = if total > 0 {
            2.0 + (downloaded as f64 / total as f64) * 66.0
        } else {
            35.0
        };
        emit(
            app,
            "install-progress",
            pct,
            format!("正在下载核心组件... {}%", pct as u32),
            "Downloading",
        );
    }
    file.flush()?;
    Ok(())
}

/// Try to open the Shell package that the release build appended to this exe.
/// A zip is located by its end-of-central-directory record, so appending a zip
/// to the exe yields a file that is both a valid executable and a valid archive;
/// the `zip` crate transparently handles the executable prefix.
fn embedded_shell_archive() -> Option<zip::ZipArchive<std::fs::File>> {
    let exe = std::env::current_exe().ok()?;
    let file = std::fs::File::open(exe).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    if archive.is_empty() {
        return None;
    }
    // Guard against a plain exe that happens to contain stray zip-like bytes:
    // require a recognizable launcher entry.
    let looks_like_pkg = (0..archive.len()).any(|i| {
        archive
            .by_index(i)
            .map(|e| {
                let n = e.name().to_ascii_lowercase();
                n.contains("launcher") || n.contains("napcat")
            })
            .unwrap_or(false)
    });
    if looks_like_pkg {
        Some(archive)
    } else {
        None
    }
}

fn has_embedded_payload() -> bool {
    embedded_shell_archive().is_some()
}

/// Extract a zip file from disk (download fallback path).
fn extract_zip_flat(app: &AppHandle, zip_path: &Path, dest: &Path) -> anyhow::Result<()> {
    let file = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    extract_archive(app, &mut archive, dest)
}

/// Extract an archive. Shell packages wrap everything in a single top-level
/// folder; we strip that folder so `install_dir` becomes the package root.
fn extract_archive<R: Read + Seek>(
    app: &AppHandle,
    archive: &mut zip::ZipArchive<R>,
    dest: &Path,
) -> anyhow::Result<()> {
    let total = archive.len();

    // Detect a common top-level directory to strip.
    let mut root_prefix: Option<String> = None;
    {
        let mut roots = std::collections::HashSet::new();
        for i in 0..total {
            let name = archive.by_index(i)?.name().to_string();
            if let Some(first) = name.split('/').next() {
                if !first.is_empty() {
                    roots.insert(first.to_string());
                }
            }
        }
        if roots.len() == 1 {
            root_prefix = roots.into_iter().next();
        }
    }

    for i in 0..total {
        let mut entry = archive.by_index(i)?;
        let raw = entry.name().to_string();
        let rel = match &root_prefix {
            Some(prefix) => raw
                .strip_prefix(&format!("{prefix}/"))
                .unwrap_or(&raw)
                .to_string(),
            None => raw,
        };
        if rel.is_empty() {
            continue;
        }
        let out_path = dest.join(&rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out = std::fs::File::create(&out_path)?;
            std::io::copy(&mut entry, &mut out)?;
        }
        if i % 20 == 0 || i + 1 == total {
            let pct = 5.0 + ((i + 1) as f64 / total as f64) * 85.0;
            emit(app, "install-progress", pct, "正在展开核心组件...", "Extracting");
        }
    }
    Ok(())
}

/// Write NapCat WebUI config (with our token) and register the QCE config dir.
fn write_runtime_config(install_dir: &Path, state: &State<'_, AppState>) -> anyhow::Result<()> {
    let config_dir = install_dir.join("config");
    std::fs::create_dir_all(&config_dir)?;

    let token = util::random_token(16);
    let webui = serde_json::json!({
        "host": "127.0.0.1",
        "port": util::NAPCAT_WEBUI_PORT,
        "token": token,
        "loginRate": 10,
        "autoLoginAccount": "",
        "disableWebUI": false
    });
    std::fs::write(
        config_dir.join("webui.json"),
        serde_json::to_vec_pretty(&webui)?,
    )?;

    std::fs::create_dir_all(util::qce_config_dir(install_dir))?;
    std::fs::create_dir_all(install_dir.join("logs"))?;

    if let Ok(mut inner) = state.0.lock() {
        inner.webui_token = Some(token);
        inner.install_dir = Some(install_dir.to_path_buf());
    }
    Ok(())
}

#[cfg(windows)]
fn create_desktop_shortcut(install_dir: &Path) -> anyhow::Result<()> {
    // Create a .lnk via a throwaway PowerShell one-liner (WScript.Shell).
    let desktop = dirs::desktop_dir().ok_or_else(|| anyhow::anyhow!("无法定位桌面目录"))?;
    let lnk = desktop.join("QQ Chat Exporter.lnk");
    let target = std::env::current_exe()?;
    let ps = format!(
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{}');$s.TargetPath='{}';$s.WorkingDirectory='{}';$s.Save()",
        lnk.display(),
        target.display(),
        install_dir.display()
    );
    util::hidden_command("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps])
        .status()?;
    Ok(())
}

#[cfg(not(windows))]
fn create_desktop_shortcut(_install_dir: &Path) -> anyhow::Result<()> {
    Ok(())
}

#[cfg(windows)]
fn set_auto_start(install_dir: &Path, enable: bool) -> anyhow::Result<()> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run, _) = hkcu.create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")?;
    if enable {
        let exe = std::env::current_exe()?;
        let _ = install_dir;
        run.set_value("QQChatExporter", &exe.to_string_lossy().to_string())?;
    } else {
        let _ = run.delete_value("QQChatExporter");
    }
    Ok(())
}

#[cfg(not(windows))]
fn set_auto_start(_install_dir: &Path, _enable: bool) -> anyhow::Result<()> {
    Ok(())
}
