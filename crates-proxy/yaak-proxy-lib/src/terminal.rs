//! Opens a terminal whose shell has the proxy's environment set, so what runs in it goes through
//! the proxy. macOS's Terminal only for now.

/// The script Terminal runs: it deletes itself, exports `vars`, then becomes a fresh interactive
/// login shell, the user's own. Fails on a name a shell could not export.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn script(vars: &[(String, String)]) -> Result<String, String> {
    let mut script = String::from("#!/bin/sh\nrm -f \"$0\"\n");
    for (name, value) in vars {
        let valid = name.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
        if !valid {
            return Err(format!("{name:?} is not a name an environment variable can have"));
        }
        script.push_str(&format!("export {name}='{}'\n", value.replace('\'', r"'\''")));
    }
    script.push_str("exec \"${SHELL:-/bin/zsh}\" -l\n");
    Ok(script)
}

/// Opens a Terminal window whose shell starts with `vars` set, through a `.command` script in
/// the temporary directory that deletes itself as it runs.
#[cfg(target_os = "macos")]
pub fn open(vars: &[(String, String)]) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let script = script(vars)?;
    let name = format!("yaak-proxy-{}.command", yaak_database::generate_prefixed_id("sh"));
    let path = std::env::temp_dir().join(name);
    let fail = |e: std::io::Error| format!("Failed to write {}: {e}", path.display());
    std::fs::write(&path, script).map_err(fail)?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).map_err(fail)?;
    let output = std::process::Command::new("/usr/bin/open")
        .args(["-a", "Terminal"])
        .arg(&path)
        .output()
        .map_err(|e| format!("Failed to run open: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let _ = std::fs::remove_file(&path);
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() { format!("open exited with {}", output.status) } else { stderr })
}

#[cfg(not(target_os = "macos"))]
pub fn open(_vars: &[(String, String)]) -> Result<(), String> {
    Err("Opening a terminal is only supported on macOS".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_script_exports_each_variable_quoted_then_starts_a_login_shell() {
        let vars = vec![
            ("HTTPS_PROXY".to_string(), "http://127.0.0.1:9090".to_string()),
            ("NOTE".to_string(), "it's $HOME".to_string()),
        ];
        assert_eq!(
            script(&vars).unwrap(),
            "#!/bin/sh\nrm -f \"$0\"\nexport HTTPS_PROXY='http://127.0.0.1:9090'\n\
            export NOTE='it'\\''s $HOME'\nexec \"${SHELL:-/bin/zsh}\" -l\n"
        );
        for name in ["", "1A", "A B", "A;rm"] {
            assert!(script(&[(name.to_string(), "x".to_string())]).is_err(), "{name:?}");
        }
    }

    #[test]
    fn the_script_runs_as_a_shell_sets_them() {
        let vars = vec![("YAAK_TEST".to_string(), "a 'b' $c".to_string())];
        // Without deleting itself, as `$0` is no script here, or starting a shell.
        let script = script(&vars)
            .unwrap()
            .replace("rm -f \"$0\"\n", "")
            .replace("exec \"${SHELL:-/bin/zsh}\" -l\n", "");
        let output = std::process::Command::new("sh")
            .args(["-c", &format!("{script}printf %s \"$YAAK_TEST\"")])
            .output();
        // Only where there is a POSIX shell.
        if let Ok(output) = output {
            assert_eq!(String::from_utf8_lossy(&output.stdout), "a 'b' $c");
        }
    }
}
