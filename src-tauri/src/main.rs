// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Linux-only: inside the AppImage on a Wayland session, force the HOST's
/// libwayland to load instead of the Ubuntu-bundled copies.
///
/// The AppImage bundles Ubuntu 22.04's libwayland-*; when host Mesa (e.g.
/// rolling distros like CachyOS/Arch) interprets Wayland objects created by
/// the stale bundled lib, EGL display creation aborts with
/// `EGL_BAD_PARAMETER` before any workaround env var can help (verified:
/// deleting bundled libwayland-* from the AppImage fixes startup).
/// LD_PRELOAD only takes effect at exec time, so this re-execs once with
/// the host libs preloaded. All-or-nothing per directory so host/bundled
/// sets can never mix. No-op everywhere else (dev builds, .deb, Windows,
/// macOS, X11 sessions).
#[cfg(target_os = "linux")]
fn ensure_host_wayland_libs() {
    if std::env::var_os("APPIMAGE").is_none()
        || std::env::var_os("WAYLAND_DISPLAY").is_none()
        || std::env::var_os("EMTY_HOST_WAYLAND").is_some()
    {
        return;
    }

    const LIBS: [&str; 4] = [
        "libwayland-client.so.0",
        "libwayland-egl.so.1",
        "libwayland-cursor.so.0",
        "libwayland-server.so.0",
    ];
    const DIRS: [&str; 4] = [
        "/usr/lib",
        "/usr/lib64",
        "/usr/lib/x86_64-linux-gnu",
        "/usr/lib/aarch64-linux-gnu",
    ];

    let Some(dir) = DIRS
        .iter()
        .find(|dir| LIBS.iter().all(|lib| std::path::Path::new(dir).join(lib).is_file()))
    else {
        return;
    };

    let mut preload = LIBS
        .iter()
        .map(|lib| format!("{dir}/{lib}"))
        .collect::<Vec<_>>()
        .join(":");
    if let Some(existing) = std::env::var_os("LD_PRELOAD") {
        if let Some(existing) = existing.to_str() {
            if !existing.is_empty() {
                preload.push(':');
                preload.push_str(existing);
            }
        }
    }
    eprintln!("[emty] AppImage on Wayland: preloading host libwayland from {dir}");
    std::env::set_var("LD_PRELOAD", preload);
    std::env::set_var("EMTY_HOST_WAYLAND", "1");

    let exe =
        std::env::current_exe().unwrap_or_else(|_| std::path::PathBuf::from("/proc/self/exe"));
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let code = std::process::Command::new(&exe)
        .args(&args)
        .status()
        .map(|status| status.code().unwrap_or(1))
        .unwrap_or(1);
    std::process::exit(code);
}

fn main() {
    #[cfg(target_os = "linux")]
    ensure_host_wayland_libs();

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
