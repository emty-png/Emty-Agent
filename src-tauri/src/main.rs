// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Linux/Wayland: GDK derives xdg_toplevel app_id from the program name,
    // NOT from the GtkApplication id (enableGTKAppId only claims the D-Bus
    // name). Align it with the tauri.conf.json identifier so compositors
    // match windows to com.emty.desktop for the taskbar icon. Must run
    // before Tao/GTK initialization in run().
    #[cfg(target_os = "linux")]
    {
        gtk::glib::set_prgname(Some("com.emty"));
        gtk::glib::set_application_name("Emty Agent");
    }

    emty_agent_lib::run()
}
