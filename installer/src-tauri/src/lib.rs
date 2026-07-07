mod install;
mod napcat;
mod qce;
mod service;
mod state;
mod util;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            install::get_default_install_dir,
            install::get_free_space,
            install::validate_install_dir,
            install::get_install_state,
            install::start_install,
            service::detect_package_kind,
            service::start_service,
            service::stop_service,
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
