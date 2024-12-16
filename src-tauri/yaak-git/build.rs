const COMMANDS: &[&str] = &[
    "add",
    "checkout",
    "commit",
    "initialize",
    "log",
    "status",
    "unstage",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
