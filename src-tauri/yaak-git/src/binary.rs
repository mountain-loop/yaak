use std::path::Path;
use std::process::Command;

pub(crate) fn new_binary_command(dir: &Path) -> Command {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(dir);
    cmd
}
