use tauri::menu::{
    AboutMetadata, Menu, MenuItemBuilder, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID,
    WINDOW_SUBMENU_ID,
};
pub use tauri::AppHandle;
use tauri::Runtime;

pub fn app_menu<R: Runtime>(app_handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let pkg_info = app_handle.package_info();
    let config = app_handle.config();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };

    let window_menu = Submenu::with_id_and_items(
        app_handle,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app_handle, None)?,
            &PredefinedMenuItem::maximize(app_handle, None)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::separator(app_handle)?,
            &PredefinedMenuItem::close_window(app_handle, None)?,
        ],
    )?;

    let help_menu = Submenu::with_id_and_items(
        app_handle,
        HELP_SUBMENU_ID,
        "Help",
        true,
        &[
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::about(app_handle, None, Some(about_metadata.clone()))?,
            #[cfg(target_os = "macos")]
            &MenuItemBuilder::with_id("open_feedback".to_string(), "Give Feedback")
                .build(app_handle)?,
        ],
    )?;

    let menu = Menu::with_items(
        app_handle,
        &[
            #[cfg(target_os = "macos")]
            &Submenu::with_items(
                app_handle,
                pkg_info.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app_handle, None, Some(about_metadata))?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &MenuItemBuilder::with_id("settings".to_string(), "Settings")
                        .accelerator("CmdOrCtrl+,")
                        .build(app_handle)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::services(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::hide(app_handle, None)?,
                    &PredefinedMenuItem::hide_others(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::quit(app_handle, None)?,
                ],
            )?,
            #[cfg(not(any(
                target_os = "linux",
                target_os = "dragonfly",
                target_os = "freebsd",
                target_os = "netbsd",
                target_os = "openbsd"
            )))]
            &Submenu::with_items(
                app_handle,
                "File",
                true,
                &[
                    &PredefinedMenuItem::close_window(app_handle, None)?,
                    #[cfg(not(target_os = "macos"))]
                    &PredefinedMenuItem::quit(app_handle, None)?,
                ],
            )?,
            &Submenu::with_items(
                app_handle,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app_handle, None)?,
                    &PredefinedMenuItem::redo(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::cut(app_handle, None)?,
                    &PredefinedMenuItem::copy(app_handle, None)?,
                    &PredefinedMenuItem::paste(app_handle, None)?,
                    &PredefinedMenuItem::select_all(app_handle, None)?,
                ],
            )?,
            &Submenu::with_items(
                app_handle,
                "View",
                true,
                &[
                    #[cfg(target_os = "macos")]
                    &PredefinedMenuItem::fullscreen(app_handle, None)?,
                    #[cfg(target_os = "macos")]
                    &PredefinedMenuItem::separator(app_handle)?,
                    &MenuItemBuilder::with_id("zoom_reset".to_string(), "Zoom to Actual Size")
                        .accelerator("CmdOrCtrl+0")
                        .build(app_handle)?,
                    &MenuItemBuilder::with_id("zoom_in".to_string(), "Zoom In")
                        .accelerator("CmdOrCtrl+=")
                        .build(app_handle)?,
                    &MenuItemBuilder::with_id("zoom_out".to_string(), "Zoom Out")
                        .accelerator("CmdOrCtrl+-")
                        .build(app_handle)?,
                ],
            )?,
            &window_menu,
            &help_menu,
            #[cfg(dev)]
            &Submenu::with_items(
                app_handle,
                "Develop",
                true,
                &[
                    &MenuItemBuilder::with_id("dev.refresh".to_string(), "Refresh")
                        .accelerator("CmdOrCtrl+Shift+r")
                        .build(app_handle)?,
                    &MenuItemBuilder::with_id("dev.toggle_devtools".to_string(), "Open Devtools")
                        .accelerator("CmdOrCtrl+Option+i")
                        .build(app_handle)?,
                    &MenuItemBuilder::with_id("dev.reset_size".to_string(), "Reset Size")
                        .build(app_handle)?,
                    &MenuItemBuilder::with_id(
                        "dev.generate_theme_css".to_string(),
                        "Generate Theme CSS",
                    )
                    .build(app_handle)?,
                ],
            )?,
        ],
    )?;

    Ok(menu)
}
