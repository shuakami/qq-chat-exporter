// Typed bridge between the React UI and the Rust (Tauri) backend.
//
// Every backend command the installer/launcher needs is declared here so the
// UI never talks to `invoke` with stringly-typed args. Keeping the contract in
// one file makes it obvious which Rust `#[tauri::command]`s must exist.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';

/** Package variant the user installed. Shell = standalone headless QQ. */
export type PackageKind = 'shell' | 'framework';

export interface InstallOptions {
  installPath: string;
  createShortcut: boolean;
  autoStart: boolean;
}

/** Progress payload emitted on the `install-progress` event. */
export interface InstallProgress {
  percent: number;
  message: string;
  phase: 'Downloading' | 'Extracting' | 'Configuring' | 'Installing' | 'Done' | 'Error';
}

/** One selectable account returned by NapCat's quick-login list. */
export interface QuickLoginAccount {
  uin: string;
  nickName: string;
  faceUrl: string;
  /** Whether NapCat has a cached quick-login session for this account. */
  isQuickLogin: boolean;
}

export interface LoginResult {
  ok: boolean;
  /** Set when ok=false so the UI can surface the reason. */
  error?: string;
}

export interface RunningInfo {
  running: boolean;
  /** One-click WebUI URL (with access token) once QCE is up, else null. */
  webuiUrl: string | null;
}

const api = {
  // --- install target ---------------------------------------------------
  getDefaultInstallDir: () => invoke<string>('get_default_install_dir'),
  getFreeSpace: (dir: string) => invoke<number>('get_free_space', { dir }),
  validateInstallDir: (dir: string) => invoke<{ ok: boolean; error?: string }>(
    'validate_install_dir',
    { dir }
  ),

  /** Install dir of an existing installation, or null on first run / version mismatch. */
  getInstallState: () => invoke<string | null>('get_install_state'),
  /** Previously-used install dir (even on version mismatch), for pre-filling. */
  getSavedInstallDir: () => invoke<string | null>('get_saved_install_dir'),

  // --- installation -----------------------------------------------------
  startInstall: (options: InstallOptions) => invoke<void>('start_install', { options }),

  // --- runtime / launch -------------------------------------------------
  /** Returns the detected package kind (shell vs framework). */
  detectPackageKind: () => invoke<PackageKind>('detect_package_kind'),
  /** Start NapCat + QCE with a hidden console; streams to the log file. */
  startService: () => invoke<void>('start_service'),
  /** Stop QCE / NapCat and any spawned QQ. */
  stopService: () => invoke<void>('stop_service'),
  isQceRunning: () => invoke<RunningInfo>('qce_status'),
  getWebuiUrl: () => invoke<string | null>('get_webui_url'),

  // --- NapCat login automation -----------------------------------------
  getQuickLoginList: () => invoke<QuickLoginAccount[]>('napcat_quick_login_list'),
  isAccountOnline: (uin: string) => invoke<boolean>('napcat_is_online', { uin }),
  quickLogin: (uin: string) => invoke<LoginResult>('napcat_quick_login', { uin }),
  /** Returns a base64 PNG data URL for the login QR code. */
  getQrCode: () => invoke<string>('napcat_qrcode'),
  /** Poll whether the QR/quick login has completed. */
  getLoginStatus: () => invoke<boolean>('napcat_login_status'),
  killQq: () => invoke<void>('kill_qq'),

  // --- misc -------------------------------------------------------------
  openLogFile: () => invoke<void>('open_log_file'),
  openUrl: (url: string) => openUrl(url),
  pickDirectory: () => openDialog({ directory: true, multiple: false }),
  /** Hide to the system tray (the runtime keeps serving). */
  closeWindow: () => getCurrentWindow().close(),
  /** Stop everything and terminate the app. */
  exitApp: () => invoke<void>('exit_app'),

  onInstallProgress: (cb: (p: InstallProgress) => void): Promise<UnlistenFn> =>
    listen<InstallProgress>('install-progress', (e) => cb(e.payload)),
  onConfigureProgress: (cb: (p: InstallProgress) => void): Promise<UnlistenFn> =>
    listen<InstallProgress>('configure-progress', (e) => cb(e.payload)),
};

export default api;
