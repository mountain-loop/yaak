use crate::window_menu::app_menu;
use crate::{DEFAULT_WINDOW_HEIGHT, DEFAULT_WINDOW_WIDTH, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH};
use log::{info, warn};
use std::process::exit;
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, Runtime, WebviewUrl, WebviewWindow, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::mpsc;

#[derive(Default, Debug)]
pub(crate) struct CreateWindowConfig<'s> {
    pub url: &'s str,
    pub label: &'s str,
    pub title: &'s str,
    pub inner_size: Option<(f64, f64)>,
    pub position: Option<(f64, f64)>,
    pub navigation_tx: Option<mpsc::Sender<String>>,
    pub close_tx: Option<mpsc::Sender<()>>,
    pub data_dir_key: Option<String>,
    pub hide_titlebar: bool,
}

pub(crate) fn create_window<R: Runtime>(
    handle: &AppHandle<R>,
    config: CreateWindowConfig,
) -> WebviewWindow<R> {
    #[allow(unused_variables)]
    let menu = app_menu(handle).unwrap();

    // This causes the window to not be clickable (in AppImage), so disable on Linux
    #[cfg(not(target_os = "linux"))]
    handle.set_menu(menu).expect("Failed to set app menu");

    info!("Create new window label={}", config.label);

    let mut win_builder =
        tauri::WebviewWindowBuilder::new(handle, config.label, WebviewUrl::App(config.url.into()))
            .title(config.title)
            .resizable(true)
            .visible(false) // To prevent theme flashing, the frontend code calls show() immediately after configuring the theme
            .fullscreen(false)
            .disable_drag_drop_handler() // Required for frontend Dnd on windows
            .min_inner_size(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT);

    if let Some(key) = config.data_dir_key {
        #[cfg(not(target_os = "macos"))]
        {
            use std::fs;
            let dir = handle.path().temp_dir().unwrap().join("yaak_sessions").join(key);
            fs::create_dir_all(dir.clone()).unwrap();
            win_builder = win_builder.data_directory(dir);
        }

        // macOS doesn't support data dir so must use this fn instead
        #[cfg(target_os = "macos")]
        {
            let hash = md5::compute(key.as_bytes());
            let mut id = [0u8; 16];
            id.copy_from_slice(&hash[..16]); // Take the first 16 bytes of the hash
            win_builder = win_builder.data_store_identifier(id);
        }
    }

    if let Some((w, h)) = config.inner_size {
        win_builder = win_builder.inner_size(w, h);
    } else {
        win_builder = win_builder.inner_size(600.0, 600.0);
    }

    if let Some((x, y)) = config.position {
        win_builder = win_builder.position(x, y);
    } else {
        win_builder = win_builder.center();
    }

    if let Some(tx) = config.navigation_tx {
        win_builder = win_builder.on_navigation(move |url| {
            let url = url.to_string();
            let tx = tx.clone();
            tauri::async_runtime::block_on(async move {
                tx.send(url).await.unwrap();
            });
            true
        });
    }

    if config.hide_titlebar {
        #[cfg(target_os = "macos")]
        {
            use tauri::TitleBarStyle;
            win_builder = win_builder.hidden_title(true).title_bar_style(TitleBarStyle::Overlay);
        }
        #[cfg(not(target_os = "macos"))]
        {
            // Doesn't seem to work from Rust, here, so we do it in main.tsx
            win_builder = win_builder.decorations(false);
        }
    }

    if let Some(w) = handle.webview_windows().get(config.label) {
        info!("Webview with label {} already exists. Focusing existing", config.label);
        w.set_focus().unwrap();
        return w.to_owned();
    }

    let win = win_builder.build().unwrap();

    if let Some(tx) = config.close_tx {
        win.on_window_event(move |event| match event {
            WindowEvent::CloseRequested { .. } => {
                let tx = tx.clone();
                tauri::async_runtime::block_on(async move {
                    tx.send(()).await.unwrap();
                });
            }
            _ => {}
        });
    }

    let webview_window = win.clone();
    win.on_menu_event(move |w, event| {
        if !w.is_focused().unwrap() {
            return;
        }

        let event_id = event.id().0.as_str();
        match event_id {
            "quit" => exit(0),
            "close" => w.close().unwrap(),
            "zoom_reset" => w.emit("zoom_reset", true).unwrap(),
            "zoom_in" => w.emit("zoom_in", true).unwrap(),
            "zoom_out" => w.emit("zoom_out", true).unwrap(),
            "settings" => w.emit("settings", true).unwrap(),
            "open_feedback" => {
                if let Err(e) =
                    w.app_handle().opener().open_url("https://yaak.app/feedback", None::<&str>)
                {
                    warn!("Failed to open feedback {e:?}")
                }
            }

            // Commands for development
            "dev.reset_size" => webview_window
                .set_size(LogicalSize::new(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT))
                .unwrap(),
            "dev.refresh" => webview_window.eval("location.reload()").unwrap(),
            "dev.generate_theme_css" => {
                w.emit("generate_theme_css", true).unwrap();
            }
            "dev.toggle_devtools" => {
                if webview_window.is_devtools_open() {
                    webview_window.close_devtools();
                } else {
                    webview_window.open_devtools();
                }
            }
            _ => {}
        }
    });

    win
}
