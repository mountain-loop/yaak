use console::style;
use std::io::{self, IsTerminal};

pub fn info(message: &str) {
    if io::stdout().is_terminal() {
        println!("{:<8} {}", style("INFO").cyan().bold(), style(message).cyan());
    } else {
        println!("INFO     {message}");
    }
}

pub fn warning(message: &str) {
    if io::stdout().is_terminal() {
        println!("{:<8} {}", style("WARNING").yellow().bold(), style(message).yellow());
    } else {
        println!("WARNING  {message}");
    }
}

pub fn success(message: &str) {
    if io::stdout().is_terminal() {
        println!("{:<8} {}", style("SUCCESS").green().bold(), style(message).green());
    } else {
        println!("SUCCESS  {message}");
    }
}

pub fn error(message: &str) {
    if io::stderr().is_terminal() {
        eprintln!("{:<8} {}", style("ERROR").red().bold(), style(message).red());
    } else {
        eprintln!("Error: {message}");
    }
}
