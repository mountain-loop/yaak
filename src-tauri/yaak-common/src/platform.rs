use crate::platform::OperatingSystem::{Linux, MacOS, Unknown, Windows};

pub enum OperatingSystem {
    Windows,
    MacOS,
    Linux,
    Unknown,
}

pub fn get_os() -> OperatingSystem {
    if cfg!(target_os = "windows") {
        Windows
    } else if cfg!(target_os = "macos") {
        MacOS
    } else if cfg!(target_os = "linux") {
        Linux
    } else {
        Unknown
    }
}

pub fn get_os_str() -> &'static str {
    match get_os() {
        Windows => "windows",
        MacOS => "macos",
        Linux => "linux",
        Unknown => "unknown",
    }
}

pub fn get_ua_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "Win"
    } else if cfg!(target_os = "macos") {
        "Mac"
    } else if cfg!(target_os = "linux") {
        "Linux"
    } else {
        "Unknown"
    }
}

pub fn get_ua_arch() -> &'static str {
    if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else if cfg!(target_arch = "x86") {
        "i386"
    } else if cfg!(target_arch = "arm") {
        "ARM"
    } else if cfg!(target_arch = "aarch64") {
        "ARM64"
    } else {
        "Unknown"
    }
}
