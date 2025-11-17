const COMMANDS: &[&str] = &[
    "add",
    "add_credential",
    "branch",
    "checkout",
    "commit",
    "delete_branch",
    "fetch_all",
    "initialize",
    "log",
    "merge_branch",
    "pull",
    "push",
    "status",
    "unstage",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
