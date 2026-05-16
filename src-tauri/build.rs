fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "browser_mount_surface",
            "browser_resize_surface",
            "browser_unmount_surface",
            "browser_close_surface",
            "browser_surface_navigate",
            "browser_surface_reload",
            "browser_surface_screenshot",
            "browser_surface_dispatch",
        ]),
    ))
    .expect("failed to run tauri build helpers")
}
