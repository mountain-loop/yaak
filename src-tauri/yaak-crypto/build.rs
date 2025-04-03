const COMMANDS: &[&str] = &[
    "enable_encryption",
    "reveal_workspace_key",
    "set_workspace_key",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
