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
    let (dir, previous_exit) = {
        let mut inner = state.0.lock().map_err(|_| "state poisoned".to_string())?;
        let previous_exit = if let Some(child) = inner.service.as_mut() {
            match child.try_wait() {
                Ok(None) => return Ok(()),
                Ok(Some(status)) => Some(format!("previous service exited with {status}")),
                Err(error) => Some(format!("failed to inspect previous service: {error}")),
            }
        } else {
            None
        };
        if previous_exit.is_some() {
            inner.service = None;
        }
        (
            inner.install_dir().ok_or_else(|| "尚未安装".to_string())?,
            previous_exit,
        )
    };

    if let Some(message) = previous_exit {
        util::installer_log(&dir, &message);
    }
    util::installer_log(
        &dir,
        &format!("starting service (installer v{})", env!("CARGO_PKG_VERSION")),
    );

    let launcher = util::find_launcher(&dir)
        .ok_or_else(|| "未找到启动脚本（launcher-user.bat）".to_string())?;
    util::installer_log(&dir, &format!("launching {}", launcher.display()));

    // Pre-seed only a verified QQNT path. Old QQ and QQNT can coexist and both
    // register as QQ.exe; selecting the legacy client makes NapCat fail to boot.
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
        .env("QCE_LOG_DIR", dir.join("logs"))
        .env("QCE_LOG_FILE", util::log_file_path(dir))
        .env("QCE_STDIO_CAPTURED", "1")
        .env("NAPCAT_HIDE_CONSOLE", "1");
    cmd
}

#[cfg(not(windows))]
fn build_launch_command(launcher: &std::path::Path, dir: &std::path::Path) -> std::process::Command {
    let mut cmd = util::hidden_command(launcher);
    cmd.current_dir(dir)
        .env("QCE_CONFIG_DIR", util::qce_config_dir(dir))
        .env("QCE_LOG_DIR", dir.join("logs"))
        .env("QCE_LOG_FILE", util::log_file_path(dir))
        .env("QCE_STDIO_CAPTURED", "1");
    cmd
}

#[tauri::command]
pub fn stop_service(state: State<'_, AppState>) -> Result<(), String> {
    shutdown(&state);
    Ok(())
}

#[tauri::command]
pub fn restart_service(state: State<'_, AppState>) -> Result<(), String> {
    shutdown(&state);
    {
        let mut inner = state.0.lock().map_err(|_| "state poisoned".to_string())?;
        inner.credential = None;
        inner.webui_port = None;
    }
    std::thread::sleep(std::time::Duration::from_millis(500));
    start_service(state)
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

#[cfg(any(windows, test))]
fn normalized_qq_path(path: &std::path::Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase()
}

#[cfg(any(windows, test))]
fn has_qqnt_layout(executable: &std::path::Path) -> bool {
    let Some(dir) = executable.parent() else {
        return false;
    };

    if dir.join("resources/app/package.json").is_file() {
        return true;
    }

    let Ok(versions) = std::fs::read_dir(dir.join("versions")) else {
        return false;
    };
    versions.flatten().any(|entry| {
        entry
            .path()
            .join("resources/app/package.json")
            .is_file()
    })
}

#[cfg(any(windows, test))]
fn is_qqnt_executable(path: &std::path::Path) -> bool {
    if !path.is_file()
        || !path
            .file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case("QQ.exe"))
    {
        return false;
    }

    let normalized = normalized_qq_path(path);
    if normalized.ends_with("\\qq\\bin\\qq.exe") {
        return false;
    }

    normalized.contains("\\qqnt\\") || has_qqnt_layout(path)
}

#[cfg(any(windows, test))]
fn select_qqnt_candidate<I>(candidates: I) -> Option<std::path::PathBuf>
where
    I: IntoIterator<Item = std::path::PathBuf>,
{
    candidates
        .into_iter()
        .find(|candidate| is_qqnt_executable(candidate))
}

/// Best-effort discovery of the desktop QQNT executable via the registry,
/// App Paths, the tencent:// protocol handler and common install dirs.
#[cfg(windows)]
fn detect_qq_path() -> Option<String> {
    use winreg::enums::{HKEY_CLASSES_ROOT, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    // Both legacy QQ and QQNT may register under these keys. Collect every
    // candidate first, then select only a path that looks like QQNT.
    const UNINSTALL_KEYS: [(&str, isize); 3] = [
        (r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\QQ", 0),
        (
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\QQ",
            0,
        ),
        (r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\QQ", 1),
    ];
    for (subkey, hive) in UNINSTALL_KEYS {
        let root = RegKey::predef(if hive == 0 {
            HKEY_LOCAL_MACHINE
        } else {
            HKEY_CURRENT_USER
        });
        let Ok(key) = root.open_subkey(subkey) else {
            continue;
        };
        if let Ok(icon) = key.get_value::<String, _>("DisplayIcon") {
            // DisplayIcon may carry an icon index suffix like `...\QQ.exe,0`.
            let path = icon.split(',').next().unwrap_or(&icon).trim_matches('"');
            candidates.push(std::path::PathBuf::from(path));
        }
        if let Ok(uninst) = key.get_value::<String, _>("UninstallString") {
            // UninstallString points at Uninstall.exe in the QQ dir.
            let uninst = uninst.trim_matches('"');
            if let Some(parent) = std::path::Path::new(uninst).parent() {
                candidates.push(parent.join("QQ.exe"));
            }
        }
        if let Ok(dir) = key.get_value::<String, _>("InstallLocation") {
            candidates.push(std::path::Path::new(&dir).join("QQ.exe"));
        }
    }

    // App Paths registration.
    const APP_PATHS: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\QQ.exe";
    for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        if let Ok(key) = RegKey::predef(hive).open_subkey(APP_PATHS) {
            if let Ok(path) = key.get_value::<String, _>("") {
                candidates.push(std::path::PathBuf::from(path.trim_matches('"')));
            }
        }
    }

    // tencent:// protocol handler: points inside versions\<ver>\resources\app,
    // so walk up the directory tree probing for QQ.exe at each level.
    if let Ok(key) = RegKey::predef(HKEY_CLASSES_ROOT).open_subkey(r"Tencent\shell\open\command") {
        if let Ok(command) = key.get_value::<String, _>("") {
            let exe = command
                .split('"')
                .nth(1)
                .unwrap_or(command.trim())
                .to_string();
            let mut dir = std::path::Path::new(&exe).parent();
            for _ in 0..6 {
                let Some(current) = dir else { break };
                candidates.push(current.join("QQ.exe"));
                dir = current.parent();
            }
        }
    }

    // Common default locations.
    for var in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Ok(base) = std::env::var(var) {
            candidates.push(std::path::Path::new(&base).join(r"Tencent\QQNT\QQ.exe"));
        }
    }
    if let Ok(base) = std::env::var("LocalAppData") {
        candidates.push(std::path::Path::new(&base).join(r"Programs\Tencent\QQNT\QQ.exe"));
    }
    candidates.push(std::path::PathBuf::from(
        r"C:\Program Files\Tencent\QQNT\QQ.exe",
    ));
    candidates.push(std::path::PathBuf::from(
        r"D:\Program Files\Tencent\QQNT\QQ.exe",
    ));

    select_qqnt_candidate(candidates).map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::{is_qqnt_executable, select_qqnt_candidate};
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(test_name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "qce-installer-{test_name}-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create temp root");
        root
    }

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().expect("file parent")).expect("create parent");
        std::fs::write(path, b"").expect("create file");
    }

    #[test]
    fn prefers_qqnt_when_legacy_qq_is_also_installed() {
        let root = temp_root("coexisting-qq");
        let legacy = root.join("Tencent/QQ/Bin/QQ.exe");
        let qqnt = root.join("Tencent/QQNT/QQ.exe");
        touch(&legacy);
        touch(&qqnt);

        let selected = select_qqnt_candidate([legacy.clone(), qqnt.clone()]);
        assert_eq!(selected, Some(qqnt));
        assert!(!is_qqnt_executable(&legacy));

        std::fs::remove_dir_all(root).expect("cleanup temp root");
    }

    #[test]
    fn accepts_portable_qqnt_by_layout_instead_of_directory_name() {
        let root = temp_root("portable-qqnt");
        let executable = root.join("PortableQQ/QQ.exe");
        touch(&executable);
        touch(&root.join("PortableQQ/versions/9.9.0/resources/app/package.json"));

        assert!(is_qqnt_executable(&executable));

        std::fs::remove_dir_all(root).expect("cleanup temp root");
    }
}
