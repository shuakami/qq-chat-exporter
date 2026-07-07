import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

export interface UninstallProgress {
  percent: number;
  message: string;
  phase: 'Stopping' | 'Removing' | 'Cleaning' | 'Done' | 'Error';
}

export interface InstallInfo {
  installDir: string;
  version: string;
}

const api = {
  getInstallInfo: () => invoke<InstallInfo | null>('get_install_info'),
  startUninstall: (keepData: boolean) =>
    invoke<void>('start_uninstall', { keepData }),
  openInstallDir: () => invoke<void>('open_install_dir'),
  closeWindow: () => getCurrentWindow().close(),
  onUninstallProgress: (cb: (p: UninstallProgress) => void): Promise<UnlistenFn> =>
    listen<UninstallProgress>('uninstall-progress', (e) => cb(e.payload)),
};

export default api;
