use crate::cli::{GenerateArgs, PluginArgs, PluginCommands, PluginPathArg};
use crate::ui;
use keyring::Entry;
use rand::Rng;
use rolldown::{
    Bundler, BundlerOptions, ExperimentalOptions, InputItem, LogLevel, OutputFormat, Platform,
    WatchOption, Watcher,
};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::io::{self, IsTerminal, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::Mutex;
use walkdir::WalkDir;
use zip::CompressionMethod;
use zip::write::SimpleFileOptions;

type CommandResult<T = ()> = std::result::Result<T, String>;

const KEYRING_USER: &str = "yaak";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Environment {
    Production,
    Staging,
    Development,
}

impl Environment {
    fn api_base_url(self) -> &'static str {
        match self {
            Environment::Production => "https://api.yaak.app",
            Environment::Staging => "https://todo.yaak.app",
            Environment::Development => "http://localhost:9444",
        }
    }

    fn keyring_service(self) -> &'static str {
        match self {
            Environment::Production => "app.yaak.cli.Token",
            Environment::Staging => "app.yaak.cli.staging.Token",
            Environment::Development => "app.yaak.cli.dev.Token",
        }
    }
}

pub async fn run_build(args: PluginPathArg) -> i32 {
    match build(args).await {
        Ok(()) => 0,
        Err(error) => {
            ui::error(&error);
            1
        }
    }
}

pub async fn run(args: PluginArgs) -> i32 {
    match args.command {
        PluginCommands::Build(args) => run_build(args).await,
        PluginCommands::Dev(args) => run_dev(args).await,
        PluginCommands::Generate(args) => run_generate(args).await,
        PluginCommands::Publish(args) => run_publish(args).await,
    }
}

pub async fn run_dev(args: PluginPathArg) -> i32 {
    match dev(args).await {
        Ok(()) => 0,
        Err(error) => {
            ui::error(&error);
            1
        }
    }
}

pub async fn run_generate(args: GenerateArgs) -> i32 {
    match generate(args) {
        Ok(()) => 0,
        Err(error) => {
            ui::error(&error);
            1
        }
    }
}

pub async fn run_publish(args: PluginPathArg) -> i32 {
    match publish(args).await {
        Ok(()) => 0,
        Err(error) => {
            ui::error(&error);
            1
        }
    }
}

async fn build(args: PluginPathArg) -> CommandResult {
    let plugin_dir = resolve_plugin_dir(args.path)?;
    ensure_plugin_build_inputs(&plugin_dir)?;

    ui::info(&format!("Building plugin {}...", plugin_dir.display()));
    let warnings = build_plugin_bundle(&plugin_dir).await?;
    for warning in warnings {
        ui::warning(&warning);
    }
    ui::success(&format!("Built plugin bundle at {}", plugin_dir.join("build/index.js").display()));
    Ok(())
}

async fn dev(args: PluginPathArg) -> CommandResult {
    let plugin_dir = resolve_plugin_dir(args.path)?;
    ensure_plugin_build_inputs(&plugin_dir)?;

    ui::info(&format!("Watching plugin {}...", plugin_dir.display()));
    ui::info("Press Ctrl-C to stop");

    let bundler = Bundler::new(bundler_options(&plugin_dir, true))
        .map_err(|err| format!("Failed to initialize Rolldown watcher: {err}"))?;
    let watcher = Watcher::new(vec![Arc::new(Mutex::new(bundler))], None)
        .map_err(|err| format!("Failed to start Rolldown watcher: {err}"))?;

    watcher.start().await;
    Ok(())
}

fn generate(args: GenerateArgs) -> CommandResult {
    let default_name = random_name();
    let name = match args.name {
        Some(name) => name,
        None => prompt_with_default("Plugin name", &default_name)?,
    };

    let default_dir = format!("./{name}");
    let output_dir = match args.dir {
        Some(dir) => dir,
        None => PathBuf::from(prompt_with_default("Plugin dir", &default_dir)?),
    };

    if output_dir.exists() {
        return Err(format!("Plugin directory already exists: {}", output_dir.display()));
    }

    ui::info(&format!("Generating plugin in {}", output_dir.display()));
    fs::create_dir_all(output_dir.join("src"))
        .map_err(|e| format!("Failed creating plugin directory {}: {e}", output_dir.display()))?;

    write_file(&output_dir.join(".gitignore"), TEMPLATE_GITIGNORE)?;
    write_file(
        &output_dir.join("package.json"),
        &TEMPLATE_PACKAGE_JSON.replace("yaak-plugin-name", &name),
    )?;
    write_file(&output_dir.join("tsconfig.json"), TEMPLATE_TSCONFIG)?;
    write_file(&output_dir.join("README.md"), &TEMPLATE_README.replace("yaak-plugin-name", &name))?;
    write_file(
        &output_dir.join("src/index.ts"),
        &TEMPLATE_INDEX_TS.replace("yaak-plugin-name", &name),
    )?;
    write_file(&output_dir.join("src/index.test.ts"), TEMPLATE_INDEX_TEST_TS)?;

    ui::success("Plugin scaffold generated");
    ui::info("Next steps:");
    println!("  1. cd {}", output_dir.display());
    println!("  2. npm install");
    println!("  3. yaakcli build");
    Ok(())
}

async fn publish(args: PluginPathArg) -> CommandResult {
    let plugin_dir = resolve_plugin_dir(args.path)?;
    ensure_plugin_build_inputs(&plugin_dir)?;

    let environment = current_environment();
    let token = get_auth_token(environment)?
        .ok_or_else(|| "Not logged in. Run `yaakcli auth login`.".to_string())?;

    ui::info(&format!("Building plugin {}...", plugin_dir.display()));
    let warnings = build_plugin_bundle(&plugin_dir).await?;
    for warning in warnings {
        ui::warning(&warning);
    }

    ui::info("Archiving plugin");
    let archive = create_publish_archive(&plugin_dir)?;

    ui::info("Uploading plugin");
    let url = format!("{}/api/v1/plugins/publish", environment.api_base_url());
    let response = reqwest::Client::new()
        .post(url)
        .header("X-Yaak-Session", token)
        .header(reqwest::header::USER_AGENT, user_agent())
        .header(reqwest::header::CONTENT_TYPE, "application/zip")
        .body(archive)
        .send()
        .await
        .map_err(|e| format!("Failed to upload plugin: {e}"))?;

    let status = response.status();
    let body =
        response.text().await.map_err(|e| format!("Failed reading publish response body: {e}"))?;

    if !status.is_success() {
        return Err(parse_api_error(status.as_u16(), &body));
    }

    let published: PublishResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed parsing publish response JSON: {e}\nResponse: {body}"))?;
    ui::success(&format!("Plugin published {}", published.version));
    println!(" -> {}", published.url);
    Ok(())
}

#[derive(Deserialize)]
struct PublishResponse {
    version: String,
    url: String,
}

async fn build_plugin_bundle(plugin_dir: &Path) -> CommandResult<Vec<String>> {
    prepare_build_output_dir(plugin_dir)?;
    let mut bundler = Bundler::new(bundler_options(plugin_dir, false))
        .map_err(|err| format!("Failed to initialize Rolldown: {err}"))?;
    let output = bundler.write().await.map_err(|err| format!("Plugin build failed:\n{err}"))?;

    Ok(output.warnings.into_iter().map(|w| w.to_string()).collect())
}

fn prepare_build_output_dir(plugin_dir: &Path) -> CommandResult {
    let build_dir = plugin_dir.join("build");
    if build_dir.exists() {
        fs::remove_dir_all(&build_dir)
            .map_err(|e| format!("Failed to clean build directory {}: {e}", build_dir.display()))?;
    }
    fs::create_dir_all(&build_dir)
        .map_err(|e| format!("Failed to create build directory {}: {e}", build_dir.display()))
}

fn bundler_options(plugin_dir: &Path, watch: bool) -> BundlerOptions {
    BundlerOptions {
        input: Some(vec![InputItem { import: "./src/index.ts".to_string(), ..Default::default() }]),
        cwd: Some(plugin_dir.to_path_buf()),
        file: Some("build/index.js".to_string()),
        format: Some(OutputFormat::Cjs),
        platform: Some(Platform::Node),
        log_level: Some(LogLevel::Info),
        experimental: watch
            .then_some(ExperimentalOptions { incremental_build: Some(true), ..Default::default() }),
        watch: watch.then_some(WatchOption::default()),
        ..Default::default()
    }
}

fn resolve_plugin_dir(path: Option<PathBuf>) -> CommandResult<PathBuf> {
    let cwd =
        std::env::current_dir().map_err(|e| format!("Failed to read current directory: {e}"))?;
    let candidate = match path {
        Some(path) if path.is_absolute() => path,
        Some(path) => cwd.join(path),
        None => cwd,
    };

    if !candidate.exists() {
        return Err(format!("Plugin directory does not exist: {}", candidate.display()));
    }
    if !candidate.is_dir() {
        return Err(format!("Plugin path is not a directory: {}", candidate.display()));
    }

    candidate
        .canonicalize()
        .map_err(|e| format!("Failed to resolve plugin directory {}: {e}", candidate.display()))
}

fn ensure_plugin_build_inputs(plugin_dir: &Path) -> CommandResult {
    let package_json = plugin_dir.join("package.json");
    if !package_json.is_file() {
        return Err(format!(
            "{} does not exist. Ensure that you are in a plugin directory.",
            package_json.display()
        ));
    }

    let entry = plugin_dir.join("src/index.ts");
    if !entry.is_file() {
        return Err(format!("Required entrypoint missing: {}", entry.display()));
    }

    Ok(())
}

fn create_publish_archive(plugin_dir: &Path) -> CommandResult<Vec<u8>> {
    let required_files = [
        "README.md",
        "package.json",
        "build/index.js",
        "src/index.ts",
    ];
    let optional_files = ["package-lock.json"];

    let mut selected = HashSet::new();
    for required in required_files {
        let required_path = plugin_dir.join(required);
        if !required_path.is_file() {
            return Err(format!("Missing required file: {required}"));
        }
        selected.insert(required.to_string());
    }
    for optional in optional_files {
        selected.insert(optional.to_string());
    }

    let cursor = std::io::Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    for entry in WalkDir::new(plugin_dir) {
        let entry = entry.map_err(|e| format!("Failed walking plugin directory: {e}"))?;
        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        let rel = path
            .strip_prefix(plugin_dir)
            .map_err(|e| format!("Failed deriving relative path for {}: {e}", path.display()))?;
        let rel = rel.to_string_lossy().replace('\\', "/");

        let keep = rel.starts_with("src/") || rel.starts_with("build/") || selected.contains(&rel);
        if !keep {
            continue;
        }

        zip.start_file(rel, options).map_err(|e| format!("Failed adding file to archive: {e}"))?;
        let mut file = fs::File::open(path)
            .map_err(|e| format!("Failed opening file {}: {e}", path.display()))?;
        let mut contents = Vec::new();
        file.read_to_end(&mut contents)
            .map_err(|e| format!("Failed reading file {}: {e}", path.display()))?;
        zip.write_all(&contents).map_err(|e| format!("Failed writing archive contents: {e}"))?;
    }

    let cursor = zip.finish().map_err(|e| format!("Failed finalizing plugin archive: {e}"))?;
    Ok(cursor.into_inner())
}

fn write_file(path: &Path, contents: &str) -> CommandResult {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed creating directory {}: {e}", parent.display()))?;
    }
    fs::write(path, contents).map_err(|e| format!("Failed writing file {}: {e}", path.display()))
}

fn prompt_with_default(label: &str, default: &str) -> CommandResult<String> {
    if !io::stdin().is_terminal() {
        return Ok(default.to_string());
    }

    print!("{label} [{default}]: ");
    io::stdout().flush().map_err(|e| format!("Failed to flush stdout: {e}"))?;

    let mut input = String::new();
    io::stdin().read_line(&mut input).map_err(|e| format!("Failed to read input: {e}"))?;
    let trimmed = input.trim();

    if trimmed.is_empty() { Ok(default.to_string()) } else { Ok(trimmed.to_string()) }
}

fn current_environment() -> Environment {
    match std::env::var("ENVIRONMENT").as_deref() {
        Ok("staging") => Environment::Staging,
        Ok("development") => Environment::Development,
        _ => Environment::Production,
    }
}

fn keyring_entry(environment: Environment) -> CommandResult<Entry> {
    Entry::new(environment.keyring_service(), KEYRING_USER)
        .map_err(|e| format!("Failed to initialize auth keyring entry: {e}"))
}

fn get_auth_token(environment: Environment) -> CommandResult<Option<String>> {
    let entry = keyring_entry(environment)?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!("Failed to read auth token: {err}")),
    }
}

fn parse_api_error(status: u16, body: &str) -> String {
    if let Ok(value) = serde_json::from_str::<Value>(body) {
        if let Some(message) = value.get("message").and_then(Value::as_str) {
            return message.to_string();
        }
        if let Some(error) = value.get("error").and_then(Value::as_str) {
            return error.to_string();
        }
    }

    format!("API error {status}: {body}")
}

fn user_agent() -> String {
    format!("YaakCli/{} ({})", env!("CARGO_PKG_VERSION"), ua_platform())
}

fn ua_platform() -> &'static str {
    match std::env::consts::OS {
        "windows" => "Win",
        "darwin" => "Mac",
        "linux" => "Linux",
        _ => "Unknown",
    }
}

fn random_name() -> String {
    const ADJECTIVES: &[&str] = &[
        "young", "youthful", "yellow", "yielding", "yappy", "yawning", "yummy", "yucky", "yearly",
        "yester", "yeasty", "yelling",
    ];
    const NOUNS: &[&str] = &[
        "yak", "yarn", "year", "yell", "yoke", "yoga", "yam", "yacht", "yodel",
    ];

    let mut rng = rand::thread_rng();
    let adjective = ADJECTIVES[rng.gen_range(0..ADJECTIVES.len())];
    let noun = NOUNS[rng.gen_range(0..NOUNS.len())];
    format!("{adjective}-{noun}")
}

const TEMPLATE_GITIGNORE: &str = "node_modules\n";

const TEMPLATE_PACKAGE_JSON: &str = r#"{
  "name": "yaak-plugin-name",
  "private": true,
  "version": "0.0.1",
  "scripts": {
    "build": "yaakcli plugin build",
    "dev": "yaakcli plugin dev"
  },
  "devDependencies": {
    "@types/node": "^24.10.1",
    "typescript": "^5.9.3",
    "vitest": "^4.0.14"
  },
  "dependencies": {
    "@yaakapp/api": "^0.7.0"
  }
}
"#;

const TEMPLATE_TSCONFIG: &str = r#"{
  "compilerOptions": {
    "target": "es2021",
    "lib": ["DOM", "DOM.Iterable", "ESNext"],
    "useDefineForClassFields": true,
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": false,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
"#;

const TEMPLATE_README: &str = r#"# yaak-plugin-name

Describe what your plugin does.
"#;

const TEMPLATE_INDEX_TS: &str = r#"import type { PluginDefinition } from "@yaakapp/api";

export const plugin: PluginDefinition = {
  httpRequestActions: [
    {
      label: "Hello, From Plugin",
      icon: "info",
      async onSelect(ctx, args) {
        await ctx.toast.show({
          color: "success",
          message: `You clicked the request ${args.httpRequest.id}`,
        });
      },
    },
  ],
};
"#;

const TEMPLATE_INDEX_TEST_TS: &str = r#"import { describe, expect, test } from "vitest";
import { plugin } from "./index";

describe("Example Plugin", () => {
  test("Exports plugin object", () => {
    expect(plugin).toBeTypeOf("object");
  });
});
"#;

#[cfg(test)]
mod tests {
    use super::create_publish_archive;
    use std::collections::HashSet;
    use std::fs;
    use std::io::Cursor;
    use tempfile::TempDir;
    use zip::ZipArchive;

    #[test]
    fn publish_archive_includes_required_and_optional_files() {
        let dir = TempDir::new().expect("temp dir");
        let root = dir.path();

        fs::create_dir_all(root.join("src")).expect("create src");
        fs::create_dir_all(root.join("build")).expect("create build");
        fs::create_dir_all(root.join("ignored")).expect("create ignored");

        fs::write(root.join("README.md"), "# Demo\n").expect("write README");
        fs::write(root.join("package.json"), "{}").expect("write package.json");
        fs::write(root.join("package-lock.json"), "{}").expect("write package-lock.json");
        fs::write(root.join("src/index.ts"), "export const plugin = {};\n")
            .expect("write src/index.ts");
        fs::write(root.join("build/index.js"), "exports.plugin = {};\n")
            .expect("write build/index.js");
        fs::write(root.join("ignored/secret.txt"), "do-not-ship").expect("write ignored file");

        let archive = create_publish_archive(root).expect("create archive");
        let mut zip = ZipArchive::new(Cursor::new(archive)).expect("open zip");

        let mut names = HashSet::new();
        for i in 0..zip.len() {
            let file = zip.by_index(i).expect("zip entry");
            names.insert(file.name().to_string());
        }

        assert!(names.contains("README.md"));
        assert!(names.contains("package.json"));
        assert!(names.contains("package-lock.json"));
        assert!(names.contains("src/index.ts"));
        assert!(names.contains("build/index.js"));
        assert!(!names.contains("ignored/secret.txt"));
    }
}
