use std::path::PathBuf;

/// The data directory of the app with identifier `app_id`, as Tauri resolves it. Under WSL,
/// the Windows app's directory when it exists.
pub fn resolve_data_dir(app_id: &str) -> PathBuf {
    if let Some(dir) = wsl_data_dir(app_id) {
        return dir;
    }
    dirs::data_dir().expect("Could not determine data directory").join(app_id)
}

/// Detect WSL and resolve the Windows AppData\Roaming path for the app's data directory.
fn wsl_data_dir(app_id: &str) -> Option<PathBuf> {
    if !cfg!(target_os = "linux") {
        return None;
    }

    let proc_version = std::fs::read_to_string("/proc/version").ok()?;
    let is_wsl = proc_version.to_lowercase().contains("microsoft");
    if !is_wsl {
        return None;
    }

    // We're in WSL, so try to resolve the app's data directory in Windows

    // Get the Windows %APPDATA% path via cmd.exe
    let appdata_output =
        std::process::Command::new("cmd.exe").args(["/C", "echo", "%APPDATA%"]).output().ok()?;

    let win_path = String::from_utf8(appdata_output.stdout).ok()?.trim().to_string();
    if win_path.is_empty() || win_path == "%APPDATA%" {
        return None;
    }

    // Convert Windows path to WSL path using wslpath (handles custom mount points)
    let wslpath_output = std::process::Command::new("wslpath").arg(&win_path).output().ok()?;

    let wsl_appdata = String::from_utf8(wslpath_output.stdout).ok()?.trim().to_string();
    if wsl_appdata.is_empty() {
        return None;
    }

    let wsl_path = PathBuf::from(wsl_appdata).join(app_id);

    if wsl_path.exists() { Some(wsl_path) } else { None }
}
