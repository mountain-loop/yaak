fn main() {
    // Migrations are embedded with include_dir!, so trigger rebuilds when SQL files change.
    println!("cargo:rerun-if-changed=migrations");
    println!("cargo:rerun-if-changed=blob_migrations");
}
