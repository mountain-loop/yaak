use crate::error::Result;
use crate::window_menu::app_menu;
use log::{info, warn};
use rand::random;
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, Runtime, WebviewUrl, WebviewWindow, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::mpsc;

const DEFAULT_WINDOW_WIDTH: f64 = 1100.0;
const DEFAULT_WINDOW_HEIGHT: f64 = 600.0;

const MIN_WINDOW_WIDTH: f64 = 300.0;
const MIN_WINDOW_HEIGHT: f64 = 300.0;

pub(crate) const MAIN_WINDOW_PREFIX: &str = "main_";
const OTHER_WINDOW_PREFIX: &str = "other_";

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
) -> Result<WebviewWindow<R>> {
    #[allow(unused_variables)]
    let menu = app_menu(handle)?;

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
            .min_inner_size(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT);

    if let Some(key) = config.data_dir_key {
        #[cfg(not(target_os = "macos"))]
        {
            use std::fs;
            let safe_key = format!("{:x}", md5::compute(key.as_bytes()));
            let dir = handle.path().app_data_dir()?.join("window-sessions").join(safe_key);
            fs::create_dir_all(&dir)?;
            win_builder = win_builder.data_directory(dir);
        }

        // macOS doesn't support `data_directory()` so must use this fn instead
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
        w.set_focus()?;
        return Ok(w.to_owned());
    }

    let win = win_builder.build()?;

    if let Some(tx) = config.close_tx {
        win.on_window_event(move |event| match event {
            WindowEvent::CloseRequested { .. } => {
                let tx = tx.clone();
                tauri::async_runtime::spawn(async move {
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
            "hacked_quit" => {
                // Cmd+Q on macOS doesn't trigger `CloseRequested` so we use a custom Quit menu
                // and trigger close() for each window.
                w.webview_windows().iter().for_each(|(_, w)| {
                    info!("Closing window {}", w.label());
                    let _ = w.close();
                });
            }
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

    Ok(win)
}

pub(crate) fn create_main_window(handle: &AppHandle, url: &str) -> Result<WebviewWindow> {
    let mut counter = 0;
    let label = loop {
        let label = format!("{MAIN_WINDOW_PREFIX}{counter}");
        match handle.webview_windows().get(label.as_str()) {
            None => break Some(label),
            Some(_) => counter += 1,
        }
    }
    .expect("Failed to generate label for new window");

    let config = CreateWindowConfig {
        url,
        label: label.as_str(),
        title: "Yaak",
        inner_size: Some((DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT)),
        position: Some((
            // Offset by random amount so it's easier to differentiate
            100.0 + random::<f64>() * 20.0,
            100.0 + random::<f64>() * 20.0,
        )),
        hide_titlebar: true,
        ..Default::default()
    };

    create_window(handle, config)
}

pub(crate) fn create_child_window(
    parent_window: &WebviewWindow,
    url: &str,
    label: &str,
    title: &str,
    inner_size: (f64, f64),
) -> Result<WebviewWindow> {
    let app_handle = parent_window.app_handle();
    let label = format!("{OTHER_WINDOW_PREFIX}_{label}");
    let scale_factor = parent_window.scale_factor()?;

    let current_pos = parent_window.inner_position()?.to_logical::<f64>(scale_factor);
    let current_size = parent_window.inner_size()?.to_logical::<f64>(scale_factor);

    // Position the new window in the middle of the parent
    let position = (
        current_pos.x + current_size.width / 2.0 - inner_size.0 / 2.0,
        current_pos.y + current_size.height / 2.0 - inner_size.1 / 2.0,
    );

    let config = CreateWindowConfig {
        label: label.as_str(),
        title,
        url,
        inner_size: Some(inner_size),
        position: Some(position),
        hide_titlebar: true,
        ..Default::default()
    };

    let child_window = create_window(&app_handle, config)?;

    // NOTE: These listeners will remain active even when the windows close. Unfortunately,
    //   there's no way to unlisten to events for now, so we just have to be defensive.

    {
        let parent_window = parent_window.clone();
        let child_window = child_window.clone();
        child_window.clone().on_window_event(move |e| match e {
            // When the new window is destroyed, bring the other up behind it
            WindowEvent::Destroyed => {
                if let Some(w) = parent_window.get_webview_window(child_window.label()) {
                    w.set_focus().unwrap();
                }
            }
            _ => {}
        });
    }

    {
        let parent_window = parent_window.clone();
        let child_window = child_window.clone();
        parent_window.clone().on_window_event(move |e| match e {
            // When the parent window is closed, close the child
            WindowEvent::CloseRequested { .. } => child_window.close().unwrap(),
            // When the parent window is focused, bring the child above
            WindowEvent::Focused(focus) => {
                if *focus {
                    if let Some(w) = parent_window.get_webview_window(child_window.label()) {
                        w.set_focus().unwrap();
                    };
                }
            }
            _ => {}
        });
    }

    Ok(child_window)
}
