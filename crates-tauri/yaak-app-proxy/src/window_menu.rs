pub use tauri::AppHandle;
use tauri::Runtime;
use tauri::menu::{
    AboutMetadata, HELP_SUBMENU_ID, Menu, MenuItemBuilder, PredefinedMenuItem, Submenu,
    WINDOW_SUBMENU_ID,
};

/// File's Export All Flows as HAR, which the window carries out, as the list's menus do.
pub const EXPORT_HAR_ID: &str = "file.export_har";

/// The event the window hears File's Export All Flows as HAR by.
pub const EXPORT_HAR_EVENT: &str = "menu_export_har";

/// Go's Back and Forward, which the window carries out along its own places, and enables while
/// there is somewhere to go.
pub const GO_BACK_ID: &str = "go.back";
pub const GO_FORWARD_ID: &str = "go.forward";

/// The events the window hears Go's Back and Forward by.
pub const GO_BACK_EVENT: &str = "menu_go_back";
pub const GO_FORWARD_EVENT: &str = "menu_go_forward";

/// Enables Go's Back and Forward as the window has somewhere to go.
pub fn set_go_enabled<R: Runtime>(app_handle: &AppHandle<R>, back: bool, forward: bool) {
    let Some(menu) = app_handle.menu() else {
        return;
    };
    let Ok(items) = menu.items() else {
        return;
    };
    for (id, enabled) in [(GO_BACK_ID, back), (GO_FORWARD_ID, forward)] {
        let item = items
            .iter()
            .filter_map(|kind| kind.as_submenu())
            .find_map(|submenu| submenu.get(id))
            .and_then(|kind| kind.as_menuitem().cloned());
        if let Some(item) = item
            && let Err(e) = item.set_enabled(enabled)
        {
            log::warn!("Failed to enable {id}: {e}");
        }
    }
}

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

    #[cfg(target_os = "macos")]
    {
        window_menu.set_as_windows_menu_for_nsapp()?;
    }

    let help_menu = Submenu::with_id_and_items(
        app_handle,
        HELP_SUBMENU_ID,
        "Help",
        true,
        &[
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::about(app_handle, None, Some(about_metadata.clone()))?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    {
        help_menu.set_as_windows_menu_for_nsapp()?;
    }

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
                    &PredefinedMenuItem::services(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::hide(app_handle, None)?,
                    &PredefinedMenuItem::hide_others(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &MenuItemBuilder::with_id(
                        "hacked_quit".to_string(),
                        format!("Quit {}", app_handle.package_info().name),
                    )
                    .accelerator("CmdOrCtrl+q")
                    .build(app_handle)?,
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
                    &MenuItemBuilder::with_id(EXPORT_HAR_ID, "Export All Flows as HAR")
                        .build(app_handle)?,
                    &PredefinedMenuItem::separator(app_handle)?,
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
                ],
            )?,
            // Disabled until the window says there is somewhere to go.
            &Submenu::with_items(
                app_handle,
                "Go",
                true,
                &[
                    &MenuItemBuilder::with_id(GO_BACK_ID, "Back")
                        .accelerator("CmdOrCtrl+[")
                        .enabled(false)
                        .build(app_handle)?,
                    &MenuItemBuilder::with_id(GO_FORWARD_ID, "Forward")
                        .accelerator("CmdOrCtrl+]")
                        .enabled(false)
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
                ],
            )?,
        ],
    )?;

    Ok(menu)
}
