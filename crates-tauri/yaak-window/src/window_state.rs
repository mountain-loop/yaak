use log::{debug, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, Monitor, Runtime, WebviewWindow, WindowEvent};

const WINDOW_STATE_FILE: &str = "window-state.json";
const SAVE_DEBOUNCE: Duration = Duration::from_millis(1000);
static WINDOW_STATE_FILE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize)]
struct WindowState {
    width: f64,
    height: f64,
    x: f64,
    y: f64,
    maximized: bool,
}

impl WindowState {
    fn has_size(self) -> bool {
        self.width > 0.0 && self.height > 0.0
    }

    fn has_position(self) -> bool {
        self.x.is_finite() && self.y.is_finite()
    }
}

pub fn apply_saved_state<R: Runtime>(
    app_handle: &AppHandle<R>,
    state_key: &str,
    inner_size: &mut Option<(f64, f64)>,
    position: &mut Option<(f64, f64)>,
    maximized: &mut bool,
    restore_position: bool,
) {
    let Some(state) = read_window_state(app_handle, state_key) else {
        debug!("No saved window state for {state_key}");
        return;
    };

    debug!(
        "Applying saved window state for {state_key}: width={} height={} x={} y={} maximized={} restore_position={restore_position}",
        state.width, state.height, state.x, state.y, state.maximized
    );

    if state.has_size() {
        *inner_size = Some((state.width, state.height));
    }

    if restore_position && state.has_position() {
        if is_position_visible(app_handle, state) {
            *position = Some((state.x, state.y));
        } else {
            debug!("Ignoring saved window position for {state_key} because it is off-screen");
        }
    }

    *maximized = state.maximized;
}

pub fn track_window<R: Runtime>(window: &WebviewWindow<R>, state_key: &str) {
    let state_key = state_key.to_string();
    let save_generation = Arc::new(AtomicU64::new(0));
    let tracked_window = window.clone();

    window.clone().on_window_event(move |event| match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            schedule_save(tracked_window.clone(), state_key.clone(), save_generation.clone());
        }
        WindowEvent::CloseRequested { .. } => {
            save_generation.fetch_add(1, Ordering::Relaxed);
            if let Err(e) = save_window_state(&tracked_window, &state_key) {
                warn!("Failed to save window state for {state_key}: {e}");
            }
        }
        _ => {}
    });
}

fn schedule_save<R: Runtime>(
    window: WebviewWindow<R>,
    state_key: String,
    save_generation: Arc<AtomicU64>,
) {
    let generation = save_generation.fetch_add(1, Ordering::Relaxed) + 1;
    let window_for_dispatch = window.clone();

    std::thread::spawn(move || {
        std::thread::sleep(SAVE_DEBOUNCE);

        if save_generation.load(Ordering::Relaxed) != generation {
            return;
        }

        let state_key_for_save = state_key.clone();
        let window_for_save = window.clone();
        if let Err(e) = window_for_dispatch.run_on_main_thread(move || {
            if let Err(e) = save_window_state(&window_for_save, &state_key_for_save) {
                warn!("Failed to save window state for {state_key_for_save}: {e}");
            }
        }) {
            debug!("Failed to dispatch debounced window state save for {state_key}: {e}");
        }
    });
}

fn save_window_state<R: Runtime>(window: &WebviewWindow<R>, state_key: &str) -> tauri::Result<()> {
    let app_handle = window.app_handle();
    let state_path = window_state_path(&app_handle)?;
    let _lock = WINDOW_STATE_FILE_LOCK.lock().unwrap();
    let mut states = read_window_states(&state_path);
    let mut state = states.get(state_key).copied().unwrap_or_default();

    let maximized = window.is_maximized().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    let scale_factor = window.scale_factor().unwrap_or(1.0);

    if !minimized && (!maximized || !state.has_size()) {
        let size = window.inner_size()?.to_logical::<f64>(scale_factor);
        if size.width > 0.0 && size.height > 0.0 {
            state.width = size.width;
            state.height = size.height;
        }
    }

    if !minimized && (!maximized || !state.has_position()) {
        let position = window.outer_position()?.to_logical::<f64>(scale_factor);
        state.x = position.x;
        state.y = position.y;
    }

    state.maximized = maximized;
    states.insert(state_key.to_string(), state);
    write_window_states(&state_path, &states)?;
    debug!(
        "Saved window state for {state_key} to {}: width={} height={} x={} y={} maximized={} minimized={minimized}",
        state_path.display(),
        state.width,
        state.height,
        state.x,
        state.y,
        state.maximized
    );
    Ok(())
}

fn read_window_state<R: Runtime>(
    app_handle: &AppHandle<R>,
    state_key: &str,
) -> Option<WindowState> {
    let state_path = window_state_path(app_handle).ok()?;
    debug!("Reading window state for {state_key} from {}", state_path.display());
    read_window_states(&state_path).get(state_key).copied()
}

fn window_state_path<R: Runtime>(app_handle: &AppHandle<R>) -> tauri::Result<PathBuf> {
    Ok(app_handle.path().app_config_dir()?.join(WINDOW_STATE_FILE))
}

fn read_window_states(state_path: &PathBuf) -> HashMap<String, WindowState> {
    let Ok(bytes) = fs::read(state_path) else {
        return HashMap::new();
    };

    match serde_json::from_slice(&bytes) {
        Ok(states) => states,
        Err(e) => {
            warn!("Failed to read window state {}: {e}", state_path.display());
            HashMap::new()
        }
    }
}

fn write_window_states(
    state_path: &PathBuf,
    states: &HashMap<String, WindowState>,
) -> tauri::Result<()> {
    if let Some(parent) = state_path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(state_path, serde_json::to_vec_pretty(states)?)?;
    Ok(())
}

fn is_position_visible<R: Runtime>(app_handle: &AppHandle<R>, state: WindowState) -> bool {
    let Ok(monitors) = app_handle.available_monitors() else {
        return true;
    };

    monitors.into_iter().any(|monitor| monitor_intersects_window(&monitor, state))
}

fn monitor_intersects_window(monitor: &Monitor, state: WindowState) -> bool {
    let scale_factor = monitor.scale_factor();
    let position = monitor.position().to_logical::<f64>(scale_factor);
    let size = monitor.size().to_logical::<f64>(scale_factor);

    let left = position.x;
    let right = position.x + size.width;
    let top = position.y;
    let bottom = position.y + size.height;

    [
        (state.x, state.y),
        (state.x + state.width, state.y),
        (state.x, state.y + state.height),
        (state.x + state.width, state.y + state.height),
    ]
    .into_iter()
    .any(|(x, y)| x >= left && x < right && y >= top && y < bottom)
}
