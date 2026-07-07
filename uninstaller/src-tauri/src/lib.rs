mod uninstall;

use tauri::Manager;

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
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            show_main_window(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            uninstall::get_install_info,
            uninstall::start_uninstall,
            uninstall::open_install_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
