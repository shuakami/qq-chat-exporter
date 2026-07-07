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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
                use tauri_plugin_notification::NotificationExt;
                let _ = window.app_handle()
                    .notification()
                    .builder()
                    .title("QQ Chat Exporter")
                    .body("已最小化到系统托盘，服务继续运行中")
                    .show();
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
