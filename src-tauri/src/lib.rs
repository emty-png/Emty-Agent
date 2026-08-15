mod browser;
mod glob;
mod grep;
mod search;
mod terminal;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(terminal::TerminalState::default())
        .invoke_handler(tauri::generate_handler![
            browser::browser_mount_surface,
            browser::browser_resize_surface,
            browser::browser_unmount_surface,
            browser::browser_close_surface,
            browser::browser_surface_navigate,
            browser::browser_surface_reload,
            browser::browser_surface_screenshot,
            browser::browser_surface_dispatch,
            terminal::terminal_start,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close,
            glob::glob_search,
            grep::grep_search,
            search::ddg_search,
        ])
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
