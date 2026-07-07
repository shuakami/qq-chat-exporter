use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;

/// Global installer/launcher state shared across Tauri commands.
#[derive(Default)]
pub struct AppState(pub Mutex<Inner>);

#[derive(Default)]
pub struct Inner {
    /// Chosen install directory (also the extracted shell-package root).
    pub install_dir: Option<PathBuf>,
    /// Token written into `config/webui.json`; used to auth against NapCat.
    pub webui_token: Option<String>,
    /// Bearer credential returned by NapCat's `/api/auth/login`.
    pub credential: Option<String>,
    /// Handle to the launched NapCat process (so we can stop it on exit).
    pub service: Option<Child>,
    /// Actual port NapCat WebUI ended up listening on (may differ from the
    /// configured default when the preferred port was already in use).
    pub webui_port: Option<u16>,
}

impl Inner {
    pub fn install_dir(&self) -> Option<PathBuf> {
        self.install_dir.clone()
    }
}
