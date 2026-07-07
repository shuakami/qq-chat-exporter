mod install;
mod napcat;
mod qce;
mod service;
mod state;
mod util;

use state::AppState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg(windows)]
const AUMID: &str = "wiki.sdjz.qce.installer";

/// Windows toast notifications require a registered AppUserModelID.
/// Setting it on the process is not enough for an unpackaged (non-MSIX)
/// app: the AUMID must also exist under
/// `HKCU\Software\Classes\AppUserModelId\<AUMID>` with a DisplayName,
/// otherwise the toast is silently dropped by the notification platform.
#[cfg(windows)]
fn register_aumid() {
    extern "system" {
        fn SetCurrentProcessExplicitAppUserModelID(app_id: *const u16) -> i32;
    }
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    let id: Vec<u16> = OsStr::new(AUMID)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        SetCurrentProcessExplicitAppUserModelID(id.as_ptr());
    }

    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok((key, _)) =
        hkcu.create_subkey(format!(r"Software\Classes\AppUserModelId\{AUMID}"))
    {
        let _ = key.set_value("DisplayName", &"QQ Chat Exporter");
        if let Ok(exe) = std::env::current_exe() {
            let _ = key.set_value("IconUri", &exe.to_string_lossy().to_string());
        }
    }

    // Also create a Start Menu shortcut with AUMID so the toast notification
    // platform can find the app icon (required for unpackaged apps).
    if let (Ok(exe), Some(start_menu)) = (std::env::current_exe(), dirs::data_dir()) {
        let programs = start_menu
            .parent()
            .unwrap_or(&start_menu)
            .join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs");
        let lnk = programs.join("QQ Chat Exporter.lnk");
        if !lnk.exists() {
            let ps = format!(
                "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{}');$s.TargetPath='{}';$s.Save()",
                lnk.display(),
                exe.display(),
            );
            let _ = util::hidden_command("powershell")
                .args(["-NoProfile", "-Command", &ps])
                .status();
        }
    }
}

/// Save the embedded app icon to a persistent location and return its path.
/// The WinRT toast notification needs a file path for the AppLogoOverride.
#[cfg(windows)]
fn notification_icon_path() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let icon_path = exe.parent()?.join("qce-notification-icon.png");
    if !icon_path.exists() {
        let _ = std::fs::write(&icon_path, include_bytes!("../icons/32x32.png"));
    }
    Some(icon_path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    register_aumid();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // A second instance tried to launch — focus the existing window.
            show_main_window(app);
        }))
        .manage(AppState::default())
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "打开面板", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("QQ Chat Exporter")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "quit" => {
                        service::shutdown(&app.state::<AppState>());
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window hides to the tray; the runtime keeps serving.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
                // Notify the user the app is still running in the background.
                #[cfg(windows)]
                {
                    let result = {
                        let mut toast = tauri_winrt_notification::Toast::new(AUMID)
                            .title("QQ Chat Exporter")
                            .text1("已最小化到系统托盘，服务继续运行中");
                        if let Some(icon) = notification_icon_path() {
                            toast = toast.icon(
                                &icon,
                                tauri_winrt_notification::IconCrop::Square,
                                "QCE",
                            );
                        }
                        toast.show()
                    };
                    let state = window.app_handle().state::<AppState>();
                    if let Some(dir) = state.0.lock().ok().and_then(|s| s.install_dir()) {
                        match result {
                            Ok(()) => util::installer_log(&dir, "window hidden to tray, toast shown"),
                            Err(e) => util::installer_log(&dir, &format!("tray toast failed: {e}")),
                        }
                    }
                }
                #[cfg(not(windows))]
                {
                    use tauri_plugin_notification::NotificationExt;
                    let _ = window.app_handle()
                        .notification()
                        .builder()
                        .title("QQ Chat Exporter")
                        .body("已最小化到系统托盘，服务继续运行中")
                        .show();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            install::get_default_install_dir,
            install::get_free_space,
            install::validate_install_dir,
            install::get_install_state,
            install::get_saved_install_dir,
            install::start_install,
            service::detect_package_kind,
            service::start_service,
            service::stop_service,
            service::exit_app,
            napcat::napcat_quick_login_list,
            napcat::napcat_is_online,
            napcat::napcat_quick_login,
            napcat::napcat_qrcode,
            napcat::napcat_login_status,
            napcat::kill_qq,
            qce::qce_status,
            qce::get_webui_url,
            qce::open_log_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                service::shutdown(&app.state::<AppState>());
            }
        });
}
