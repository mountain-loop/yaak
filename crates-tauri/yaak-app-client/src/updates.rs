use std::time::Instant;

use crate::error::Result;
use crate::models_ext::QueryManagerExt;
use log::info;
use tauri::{Manager, Runtime, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::task::block_in_place;

use url::Url;
use yaak_api::get_system_proxy_url;
use yaak_updater::{UpdateGate, UpdateInstall};
pub use yaak_updater::{UpdateMode, UpdateTrigger};

use crate::is_dev;

// Create updater struct
pub struct YaakUpdater {
    last_check: Option<Instant>,
}

impl YaakUpdater {
    pub fn new() -> Self {
        Self { last_check: None }
    }

    pub async fn check_now<R: Runtime>(
        &mut self,
        window: &WebviewWindow<R>,
        mode: UpdateMode,
        auto_download: bool,
        update_trigger: UpdateTrigger,
    ) -> Result<bool> {
        // One check and one update at a time, whichever window or trigger asks. The user who
        // asks while one is in hand sees where it stands, so there's no "no update" to show.
        let token = match window.state::<UpdateGate>().begin_check() {
            Ok(token) => token,
            Err(busy) => {
                info!("Not checking for updates: the update is {:?}", busy.state);
                if update_trigger == UpdateTrigger::User {
                    busy.show(window);
                    return Ok(true);
                }
                return Ok(false);
            }
        };

        let settings = window.db().get_settings();
        let update_key = format!("{:x}", md5::compute(settings.id));
        self.last_check = Some(Instant::now());

        info!("Checking for updates mode={} autodl={}", mode, auto_download);

        let w = window.clone();
        let mut updater_builder = w.updater_builder();
        if let Some(proxy_url) = get_system_proxy_url() {
            if let Ok(url) = Url::parse(&proxy_url) {
                updater_builder = updater_builder.proxy(url);
            }
        }
        let update_check_result = updater_builder
            .on_before_exit(move || {
                // Kill plugin manager before exit or NSIS installer will fail to replace sidecar
                // while it's running.
                // NOTE: This is only called on Windows
                let w = w.clone();
                block_in_place(|| {
                    tauri::async_runtime::block_on(async move {
                        info!("Shutting down plugin manager before update");
                        if let Ok(plugin_manager) = crate::plugins_ext::plugin_manager(&w).await {
                            plugin_manager.terminate().await;
                        }
                    });
                });
            })
            .header("X-Update-Mode", mode.to_string())?
            .header("X-Update-Key", update_key)?
            .header("X-Update-Trigger", update_trigger.header_value())?
            .header("X-Install-Mode", detect_install_mode().unwrap_or("unknown"))?
            .build()?
            .check()
            .await;

        let result = match update_check_result? {
            None => false,
            Some(update) => {
                let install = update_install_method(&update);
                token.offer(window, update, update_trigger, auto_download, install);
                true
            }
        };

        Ok(result)
    }
    pub async fn maybe_check<R: Runtime>(
        &mut self,
        window: &WebviewWindow<R>,
        auto_download: bool,
        mode: UpdateMode,
    ) -> Result<bool> {
        if let Some(i) = self.last_check
            && i.elapsed() < mode.check_interval()
        {
            return Ok(false);
        }

        // Don't check if development (can still with manual user trigger)
        if is_dev() {
            return Ok(false);
        }

        self.check_now(window, mode, auto_download, UpdateTrigger::Background).await
    }
}

/// Detect the installer type so the update server can serve the correct artifact.
fn detect_install_mode() -> Option<&'static str> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(exe) = std::env::current_exe() {
            let path = exe.to_string_lossy().to_lowercase();
            if path.starts_with(r"c:\program files") {
                return Some("nsis-machine");
            }
        }
        return Some("nsis");
    }
    #[allow(unreachable_code)]
    if !cfg!(target_os = "linux") {
        None
    } else if is_flatpak() {
        Some("flatpak")
    } else {
        linux_installer()
    }
}

/// Flatpak installs (e.g. FlatPark) are updated by flatpak from their remote; the in-app
/// updater can't write inside the sandbox and must not try.
fn is_flatpak() -> bool {
    std::env::var_os("FLATPAK_ID").is_some()
}

/// How Yaak was installed on Linux, as far as the updater plugin can install into it.
///
/// The bundle type is stamped into the binary by the bundler, but that only says how the
/// binary was *packaged*: third-party packages (AUR, Nix, ...) repackage the .deb, and
/// letting dpkg/rpm replace those would stomp on another package manager's files. So a
/// deb/rpm install also has to be one the package manager actually owns. The AppImage
/// updater needs `$APPIMAGE` since that's the file it replaces.
fn linux_installer() -> Option<&'static str> {
    use tauri::utils::{config::BundleType, platform::bundle_type};
    match bundle_type() {
        Some(BundleType::Deb) if package_manager_owns_exe("dpkg", "-S") => Some("deb"),
        Some(BundleType::Rpm) if package_manager_owns_exe("rpm", "-qf") => Some("rpm"),
        Some(BundleType::Deb) | Some(BundleType::Rpm) => None,
        _ if std::env::var_os("APPIMAGE").is_some() => Some("appimage"),
        _ => None,
    }
}

/// Whether `cmd query_arg <current exe>` succeeds, i.e. that package manager knows the
/// running executable as one of its files. False when the tool isn't installed at all.
fn package_manager_owns_exe(cmd: &str, query_arg: &str) -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    std::process::Command::new(cmd)
        .arg(query_arg)
        .arg(&exe)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// How the artifact the server returned can be applied to this install. On Linux the
/// server may hand back a different package format than the one installed, Flatpak can't
/// be written from inside the sandbox, and unknown install methods (distro packages,
/// Nix, ...) can't be updated in-app at all.
fn update_install_method(update: &Update) -> UpdateInstall {
    // Dev-only override to preview the non-integrated flows on any OS:
    //   YAAK_SIMULATE_INSTALL=flatpak|manual
    if is_dev() {
        match std::env::var("YAAK_SIMULATE_INSTALL").as_deref() {
            Ok("flatpak") => return UpdateInstall::Flatpak,
            Ok("manual") => return UpdateInstall::Manual,
            _ => {}
        }
    }

    if !cfg!(target_os = "linux") {
        return UpdateInstall::Integrated;
    }
    if is_flatpak() {
        return UpdateInstall::Flatpak;
    }
    if artifact_matches_installer(linux_installer(), update.download_url.path()) {
        UpdateInstall::Integrated
    } else {
        UpdateInstall::Manual
    }
}

/// Whether the artifact at `url_path` is in the package format `installer` can install.
fn artifact_matches_installer(installer: Option<&str>, url_path: &str) -> bool {
    let path = url_path.to_ascii_lowercase();
    match installer {
        Some("deb") => path.ends_with(".deb"),
        Some("rpm") => path.ends_with(".rpm"),
        Some("appimage") => path.ends_with(".appimage") || path.ends_with(".appimage.tar.gz"),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::artifact_matches_installer;

    const BASE: &str = "/mountain-loop/yaak/releases/download/v2026.6.0/";

    #[test]
    fn matching_package_format_is_installable() {
        let cases = [
            ("deb", "yaak_2026.6.0_amd64.deb"),
            ("deb", "yaak_2026.6.0_arm64.deb"),
            ("rpm", "yaak-2026.6.0-1.x86_64.rpm"),
            ("rpm", "yaak-2026.6.0-1.aarch64.rpm"),
            ("appimage", "yaak_2026.6.0_amd64.AppImage"),
            ("appimage", "yaak_2026.6.0_amd64.AppImage.tar.gz"),
        ];
        for (installer, asset) in cases {
            assert!(
                artifact_matches_installer(Some(installer), &format!("{BASE}{asset}")),
                "{installer} should install {asset}"
            );
        }
    }

    #[test]
    fn mismatched_package_format_is_not_installable() {
        // What the server returns for every Linux install today
        let appimage = format!("{BASE}yaak_2026.6.0_amd64.AppImage");
        assert!(!artifact_matches_installer(Some("deb"), &appimage));
        assert!(!artifact_matches_installer(Some("rpm"), &appimage));

        let deb = format!("{BASE}yaak_2026.6.0_amd64.deb");
        assert!(!artifact_matches_installer(Some("rpm"), &deb));
        assert!(!artifact_matches_installer(Some("appimage"), &deb));
    }

    #[test]
    fn unknown_installer_is_never_installable() {
        for asset in ["yaak_2026.6.0_amd64.deb", "yaak_2026.6.0_amd64.AppImage"] {
            assert!(!artifact_matches_installer(None, &format!("{BASE}{asset}")));
        }
    }
}
