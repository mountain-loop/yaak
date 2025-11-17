const COMMANDS: &[&str] = &[
    "add",
    "add_credential",
    "add_remote",
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
    "remotes",
    "rm_remote",
    "status",
    "unstage",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
