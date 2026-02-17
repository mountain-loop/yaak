use std::io::{self, IsTerminal, Write};

pub fn confirm_delete(resource_name: &str, resource_id: &str) -> bool {
    if !io::stdin().is_terminal() {
        eprintln!("Refusing to delete in non-interactive mode without --yes");
        std::process::exit(1);
    }

    print!("Delete {resource_name} {resource_id}? [y/N]: ");
    io::stdout().flush().expect("Failed to flush stdout");

    let mut input = String::new();
    io::stdin().read_line(&mut input).expect("Failed to read confirmation");

    matches!(input.trim().to_lowercase().as_str(), "y" | "yes")
}
