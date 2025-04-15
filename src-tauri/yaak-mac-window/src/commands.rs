use tauri::{Runtime, Window, command};

#[command]
pub(crate) fn set_title<R: Runtime>(window: Window<R>, title: &str) {
    #[cfg(target_os = "macos")]
    {
        crate::mac::update_window_title(window, title.to_string());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.set_title(title);
    }
}

#[command]
#[allow(unused)]
pub(crate) fn set_theme<R: Runtime>(window: Window<R>, bg_color: &str) {
    #[cfg(target_os = "macos")]
    {
        match hex_color::HexColor::parse_rgb(bg_color.trim()) {
            Ok(color) => {
                crate::mac::update_window_theme(window, color);
            }
            Err(err) => {
                log::warn!("Failed to parse background color '{}': {}", bg_color, err)
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        // Nothing yet for non-Mac platforms
    }
}
