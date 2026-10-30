#[cfg(target_os = "macos")]
fn main() {
    std::process::exit(yaak_proxy_helper::daemon::run());
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("yaak-proxy-helper only runs on macOS");
    std::process::exit(1);
}
