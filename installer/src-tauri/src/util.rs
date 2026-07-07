use std::path::{Path, PathBuf};
use std::process::Command;

/// NapCat WebUI listens here; the installer pre-writes the token so it can talk
/// to the login API without scraping the console.
pub const NAPCAT_WEBUI_PORT: u16 = 6099;
/// QCE (QQ Chat Exporter) HTTP server / WebUI port.
pub const QCE_PORT: u16 = 40653;

/// Windows `CREATE_NO_WINDOW` flag — keeps NapCat's console hidden.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Build a `Command` whose child console window is suppressed on Windows.
pub fn hidden_command<P: AsRef<Path>>(program: P) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program.as_ref());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Generate a short hex token for the NapCat WebUI (`config/webui.json`).
pub fn random_token(len: usize) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    // Not cryptographically strong, but this token only guards a loopback-only
    // WebUI the installer itself launches; uniqueness per install is enough.
    let mut seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
        ^ (std::process::id() as u128).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    let mut out = String::with_capacity(len);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    while out.len() < len {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        out.push(HEX[(seed >> 60) as usize & 0xf] as char);
    }
    out
}

/// Directory where QCE writes `security.json` (holds the access token).
/// We pin it next to the install dir via `QCE_CONFIG_DIR` so we can read the
/// token deterministically instead of guessing the user profile.
pub fn qce_config_dir(install_dir: &Path) -> PathBuf {
    install_dir.join(".qce-config")
}

/// Absolute path to the runtime log file that "查看运行日志" opens.
pub fn log_file_path(install_dir: &Path) -> PathBuf {
    install_dir.join("logs").join("qce-runtime.log")
}

/// Append a timestamped line from the installer itself into the runtime log,
/// so "查看运行日志" shows installer activity alongside NapCat/QCE output.
pub fn installer_log(install_dir: &Path, msg: &str) {
    use std::io::Write;
    let path = log_file_path(install_dir);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let line = format!(
        "{} [installer] {}\n",
        chrono::Local::now().format("%m-%d %H:%M:%S"),
        msg
    );
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = f.write_all(line.as_bytes());
    }
}

/// Find the Windows launcher batch file inside an extracted shell package.
/// Prefers the non-elevated, no-pause variant so nothing blocks the pipe.
pub fn find_launcher(install_dir: &Path) -> Option<PathBuf> {
    const CANDIDATES: &[&str] = &[
        "launcher-user.bat",
        "launcher-win10-user.bat",
        "launcher.bat",
        "launcher-win10.bat",
    ];
    CANDIDATES
        .iter()
        .map(|name| install_dir.join(name))
        .find(|p| p.exists())
}
