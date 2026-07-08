//! Launch / stop the NapCat + QCE runtime with a hidden console and log file.

use std::process::Stdio;

use tauri::State;

use crate::state::AppState;
use crate::util;

#[tauri::command]
pub fn detect_package_kind(state: State<'_, AppState>) -> Result<String, String> {
    let dir = state
        .0
        .lock()
        .map_err(|_| "state poisoned".to_string())?
        .install_dir()
        .ok_or_else(|| "尚未安装".to_string())?;
    // Framework packages ship napiLoader.bat and coexist with desktop QQ.
    if dir.join("napiLoader.bat").exists() {
        Ok("framework".into())
    } else {
        Ok("shell".into())
    }
}

/// Kill leftover headless runtimes (NapCatWinBootMain and its QQ children).
/// A stale instance keeps port 6099 with an outdated token and rejects every
/// login, and repeated launches would otherwise pile up duplicate processes.
/// **Only called before starting a fresh service**, never on shutdown.
pub fn kill_stale_runtime() {
    #[cfg(windows)]
    {
        // Kill the launcher and its entire process tree (QQ, node, etc.).
        for image in ["NapCatWinBootMain.exe", "QQ.exe"] {
            let _ = util::hidden_command("taskkill")
                .args(["/IM", image, "/F", "/T"])
                .status();
        }
        // Brief pause so Windows releases file handles before we try to
        // overwrite the files during extraction.
        std::thread::sleep(std::time::Duration::from_millis(800));
    }
}

/// Kill only the NapCat launcher process — NOT QQ.exe.
/// Used on shutdown so the user's desktop QQ keeps running.
fn kill_napcat_only() {
    #[cfg(windows)]
    {
        let _ = util::hidden_command("taskkill")
            .args(["/IM", "NapCatWinBootMain.exe", "/F", "/T"])
            .status();
    }
}

#[tauri::command]
pub fn start_service(state: State<'_, AppState>) -> Result<(), String> {
    let dir = {
        let inner = state.0.lock().map_err(|_| "state poisoned".to_string())?;
        // Already running? Nothing to do.
        if inner.service.is_some() {
            return Ok(());
        }
        inner.install_dir().ok_or_else(|| "尚未安装".to_string())?
    };

    util::installer_log(
        &dir,
        &format!("starting service (installer v{})", env!("CARGO_PKG_VERSION")),
    );

    let launcher = util::find_launcher(&dir)
        .ok_or_else(|| "未找到启动脚本（launcher-user.bat）".to_string())?;
    util::installer_log(&dir, &format!("launching {}", launcher.display()));

    // Pre-seed the QQ path so the launcher never blocks on interactive input.
    #[cfg(windows)]
    if let Some(qq) = detect_qq_path() {
        let config = dir.join("config");
        let _ = std::fs::create_dir_all(&config);
        let _ = std::fs::write(config.join("qq_path.txt"), qq);
    }

    // Route all console output into the log file the UI can open.
    let log_path = util::log_file_path(&dir);
    if let Some(parent) = log_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let out = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| e.to_string())?;
    let err = out.try_clone().map_err(|e| e.to_string())?;

    let child = build_launch_command(&launcher, &dir)
        .stdout(Stdio::from(out))
        .stderr(Stdio::from(err))
        .stdin(Stdio::null())
        .spawn()
        .map_err(|e| {
            util::installer_log(&dir, &format!("launch failed: {e}"));
            format!("启动失败：{e}")
        })?;
    util::installer_log(&dir, &format!("service launched (pid {})", child.id()));

    let mut inner = state.0.lock().map_err(|_| "state poisoned".to_string())?;
    inner.service = Some(child);
    Ok(())
}

#[cfg(windows)]
fn build_launch_command(launcher: &std::path::Path, dir: &std::path::Path) -> std::process::Command {
    // Run the .bat through cmd so batch semantics work, hidden and headless.
    let mut cmd = util::hidden_command("cmd");
    cmd.arg("/C")
        .arg(launcher)
        .current_dir(dir)
        .env("QCE_CONFIG_DIR", util::qce_config_dir(dir))
        .env("NAPCAT_HIDE_CONSOLE", "1");
    cmd
}

#[cfg(not(windows))]
fn build_launch_command(launcher: &std::path::Path, dir: &std::path::Path) -> std::process::Command {
    let mut cmd = util::hidden_command(launcher);
    cmd.current_dir(dir)
        .env("QCE_CONFIG_DIR", util::qce_config_dir(dir));
    cmd
}

#[tauri::command]
pub fn stop_service(state: State<'_, AppState>) -> Result<(), String> {
    shutdown(&state);
    Ok(())
}

/// Explicit quit from the UI: stop everything and terminate the app
/// (a plain window close only hides to the tray).
#[tauri::command]
pub fn exit_app(app: tauri::AppHandle, state: State<'_, AppState>) {
    shutdown(&state);
    app.exit(0);
}

/// Stop the launcher child and the NapCat process it spawned.
/// Does **not** kill QQ.exe — the user's desktop QQ should keep running.
pub fn shutdown(state: &AppState) {
    if let Ok(inner) = state.0.lock() {
        if let Some(dir) = inner.install_dir() {
            util::installer_log(&dir, "shutting down service");
        }
    }
    if let Ok(mut inner) = state.0.lock() {
        if let Some(mut child) = inner.service.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    // Stop the headless NapCat the launcher spawned, but leave QQ alone.
    kill_napcat_only();
}

/// Best-effort discovery of the desktop QQ executable via the registry.
#[cfg(windows)]
fn detect_qq_path() -> Option<String> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    // QQNT records its install dir under the uninstall key.
    const UNINSTALL: &str =
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\QQ";
    for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        let root = RegKey::predef(hive);
        if let Ok(key) = root.open_subkey(UNINSTALL) {
            if let Ok(dir) = key.get_value::<String, _>("UninstallString") {
                // UninstallString points at Uninstall.exe in the QQ dir.
                if let Some(parent) = std::path::Path::new(&dir).parent() {
                    let exe = parent.join("QQ.exe");
                    if exe.exists() {
                        return Some(exe.to_string_lossy().into_owned());
                    }
                }
            }
            if let Ok(dir) = key.get_value::<String, _>("DisplayIcon") {
                let p = std::path::Path::new(&dir);
                if p.exists() {
                    return Some(p.to_string_lossy().into_owned());
                }
            }
        }
    }
    // Common default location.
    let candidate = r"C:\Program Files\Tencent\QQNT\QQ.exe";
    if std::path::Path::new(candidate).exists() {
        return Some(candidate.to_string());
    }
    None
}
