use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallInfo {
    pub install_dir: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    percent: f64,
    message: String,
    phase: String,
}

fn emit(app: &AppHandle, percent: f64, message: impl Into<String>, phase: &str) {
    let _ = app.emit(
        "uninstall-progress",
        Progress {
            percent,
            message: message.into(),
            phase: phase.to_string(),
        },
    );
}

// ---------------------------------------------------------------------------
// Installer state persistence (mirrors installer/src-tauri/src/install.rs)
// ---------------------------------------------------------------------------

fn state_file() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("qce-installer").join("state.json"))
}

fn read_install_state() -> Option<(PathBuf, String)> {
    let file = state_file()?;
    let raw = std::fs::read(file).ok()?;
    let json: serde_json::Value = serde_json::from_slice(&raw).ok()?;
    let dir = PathBuf::from(json.get("installDir")?.as_str()?);
    let version = json
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    if dir.exists() {
        Some((dir, version))
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_install_info() -> Option<InstallInfo> {
    let (dir, version) = read_install_state()?;
    Some(InstallInfo {
        install_dir: dir.to_string_lossy().into_owned(),
        version,
    })
}

#[tauri::command]
pub fn open_install_dir() -> Result<(), String> {
    if let Some((dir, _)) = read_install_state() {
        #[cfg(windows)]
        {
            let mut cmd = std::process::Command::new("explorer");
            cmd.arg(dir);
            let _ = cmd.spawn();
        }
        #[cfg(not(windows))]
        {
            let _ = std::process::Command::new("xdg-open")
                .arg(&dir)
                .spawn();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn start_uninstall(app: AppHandle, keep_data: bool) -> Result<(), String> {
    let (install_dir, _version) = read_install_state()
        .ok_or_else(|| "未找到安装信息".to_string())?;

    // 1. Stop running services
    emit(&app, 5.0, "正在停止运行中的服务...", "Stopping");
    kill_runtime();
    // Brief pause so Windows releases file handles.
    std::thread::sleep(std::time::Duration::from_millis(1500));

    // 2. Remove autostart registry entry
    emit(&app, 15.0, "正在清理注册表...", "Cleaning");
    remove_autostart();

    // 3. Remove desktop shortcut
    emit(&app, 25.0, "正在删除桌面快捷方式...", "Cleaning");
    remove_desktop_shortcut();

    // 4. Remove Start Menu shortcut
    emit(&app, 30.0, "正在删除开始菜单快捷方式...", "Cleaning");
    remove_start_menu_shortcut();

    // 5. Remove AUMID registry key
    emit(&app, 35.0, "正在清理通知注册...", "Cleaning");
    remove_aumid_registry();

    // 6. Remove installed files
    emit(&app, 40.0, "正在删除程序文件...", "Removing");
    if let Err(e) = remove_install_dir(&install_dir, keep_data, &app) {
        emit(
            &app,
            40.0,
            format!("删除文件时出错：{e}"),
            "Error",
        );
        return Err(format!("删除文件失败：{e}"));
    }

    // 7. Remove installer state config
    emit(&app, 90.0, "正在清理配置文件...", "Cleaning");
    remove_state_file();

    emit(&app, 100.0, "卸载完成", "Done");
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn kill_runtime() {
    #[cfg(windows)]
    {
        use std::process::Command;
        // Kill NapCat and QQ processes that QCE might have spawned.
        for image in ["NapCatWinBootMain.exe", "QQ Chat Exporter.exe"] {
            let _ = hidden_command("taskkill")
                .args(["/IM", image, "/F", "/T"])
                .status();
        }
    }
    #[cfg(not(windows))]
    {
        // Best-effort on non-Windows (not the primary target).
        let _ = std::process::Command::new("pkill")
            .args(["-f", "NapCat"])
            .status();
    }
}

#[cfg(windows)]
fn hidden_command(program: &str) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    let mut cmd = std::process::Command::new(program);
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd
}

fn remove_autostart() {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(run) =
            hkcu.open_subkey_with_flags(r"Software\Microsoft\Windows\CurrentVersion\Run", winreg::enums::KEY_WRITE)
        {
            let _ = run.delete_value("QQChatExporter");
        }
    }
}

fn remove_desktop_shortcut() {
    if let Some(desktop) = dirs::desktop_dir() {
        let lnk = desktop.join("QQ Chat Exporter.lnk");
        let _ = std::fs::remove_file(lnk);
    }
}

fn remove_start_menu_shortcut() {
    #[cfg(windows)]
    {
        if let Some(data_dir) = dirs::data_dir() {
            let programs = data_dir
                .parent()
                .unwrap_or(&data_dir)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs");
            let lnk = programs.join("QQ Chat Exporter.lnk");
            let _ = std::fs::remove_file(lnk);
        }
    }
}

fn remove_aumid_registry() {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let _ = hkcu.delete_subkey_all(r"Software\Classes\AppUserModelId\wiki.sdjz.qce.installer");
    }
}

/// Remove the install directory. If `keep_data` is true, preserve the
/// user's exported chat logs (typically under `output/` or `exports/`).
fn remove_install_dir(dir: &Path, keep_data: bool, app: &AppHandle) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }

    if keep_data {
        // Delete everything except data directories.
        let data_dirs: &[&str] = &["output", "exports", "logs"];
        remove_dir_except(dir, data_dirs, app)?;
    } else {
        // Nuke the whole directory tree.
        emit(app, 60.0, "正在删除所有文件...", "Removing");
        std::fs::remove_dir_all(dir)
            .map_err(|e| format!("无法删除安装目录：{e}"))?;
    }

    Ok(())
}

/// Delete everything in `dir` except subdirectories whose names are in
/// `except`. This lets us preserve exported data while removing the app.
fn remove_dir_except(dir: &Path, except: &[&str], app: &AppHandle) -> Result<(), String> {
    let entries: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .collect();

    let total = entries.len();

    for (i, entry) in entries.iter().enumerate() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        // Skip preserved directories.
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false)
            && except.iter().any(|e| name_str.eq_ignore_ascii_case(e))
        {
            continue;
        }

        let path = entry.path();
        if path.is_dir() {
            let _ = std::fs::remove_dir_all(&path);
        } else {
            let _ = std::fs::remove_file(&path);
        }

        if i % 5 == 0 || i + 1 == total {
            let pct = 40.0 + ((i + 1) as f64 / total as f64) * 48.0;
            emit(
                app,
                pct,
                format!("正在删除：{}...", name_str),
                "Removing",
            );
        }
    }

    // If the directory is now empty (no preserved data dirs either), remove it.
    if std::fs::read_dir(dir)
        .map(|mut rd| rd.next().is_none())
        .unwrap_or(true)
    {
        let _ = std::fs::remove_dir(dir);
    }

    Ok(())
}

fn remove_state_file() {
    if let Some(file) = state_file() {
        let _ = std::fs::remove_file(&file);
        // Also remove the parent directory if empty.
        if let Some(parent) = file.parent() {
            let _ = std::fs::remove_dir(parent);
        }
    }
}
