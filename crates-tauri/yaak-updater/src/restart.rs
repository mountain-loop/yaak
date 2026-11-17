#[cfg(target_os = "macos")]
use log::{error, info};
#[cfg(any(target_os = "macos", test))]
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::{Command, Stdio};
#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Runtime};

#[cfg(target_os = "macos")]
static RELAUNCH_WITH_LAUNCH_SERVICES: AtomicBool = AtomicBool::new(false);

/// Restart the app without directly spawning the executable on macOS.
///
/// Tauri's current macOS restart path starts the executable from the dying
/// process. Besides inheriting stale process state, that bypasses
/// LaunchServices and can leave the replacement app running without an active
/// window. Defer the relaunch until `RunEvent::Exit`, when the event loop is
/// already shutting down, and hand it to LaunchServices instead.
pub fn request_restart<R: Runtime>(app_handle: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    if current_app_bundle().is_some() {
        info!("Requesting restart through macOS LaunchServices");
        RELAUNCH_WITH_LAUNCH_SERVICES.store(true, Ordering::SeqCst);
        app_handle.exit(0);
        return;
    }

    app_handle.request_restart();
}

/// Complete a pending macOS restart after Tauri has emitted its exit events.
pub fn relaunch_if_requested() {
    #[cfg(target_os = "macos")]
    {
        if !RELAUNCH_WITH_LAUNCH_SERVICES.swap(false, Ordering::SeqCst) {
            return;
        }

        let Some(bundle) = current_app_bundle() else {
            error!("Failed to resolve the app bundle for restart");
            return;
        };

        match Command::new("/usr/bin/open")
            .arg("-n")
            .arg(&bundle)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(_) => info!("Relaunching {} through LaunchServices", bundle.display()),
            Err(error) => error!("Failed to relaunch through LaunchServices: {error}"),
        }
    }
}

#[cfg(target_os = "macos")]
fn current_app_bundle() -> Option<PathBuf> {
    app_bundle_from_executable(&std::env::current_exe().ok()?)
}

#[cfg(any(target_os = "macos", test))]
fn app_bundle_from_executable(executable: &Path) -> Option<PathBuf> {
    let macos_dir = executable.parent()?;
    if macos_dir.file_name()? != "MacOS" {
        return None;
    }

    let contents_dir = macos_dir.parent()?;
    if contents_dir.file_name()? != "Contents" {
        return None;
    }

    let bundle = contents_dir.parent()?;
    if bundle.extension()? != "app" {
        return None;
    }

    Some(bundle.to_owned())
}

#[cfg(test)]
mod tests {
    use super::app_bundle_from_executable;
    use std::path::{Path, PathBuf};

    #[test]
    fn resolves_macos_app_bundle() {
        assert_eq!(
            app_bundle_from_executable(Path::new(
                "/Applications/Yaak.app/Contents/MacOS/yaak-app-client"
            )),
            Some(PathBuf::from("/Applications/Yaak.app"))
        );
    }

    #[test]
    fn ignores_unbundled_executable() {
        assert_eq!(
            app_bundle_from_executable(Path::new("/workspace/target/debug/yaak-app-client")),
            None
        );
    }
}
