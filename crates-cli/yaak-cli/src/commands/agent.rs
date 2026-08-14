use crate::cli::{AgentArgs, AgentCommands};
use crate::ui;
use crate::version;
use include_dir::{Dir, include_dir};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

static SKILL_DIR: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/skills/use-yaak");

const SKILL_NAME: &str = "use-yaak";
const MANIFEST_NAME: &str = ".yaak-skill.json";

type CommandResult<T = ()> = std::result::Result<T, String>;

/// Records what this CLI wrote, so a later install can tell its own output apart
/// from edits the user made by hand.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SkillManifest {
    cli_version: String,
    /// Relative file path -> SHA-256 of the contents this CLI wrote.
    files: BTreeMap<String, String>,
}

/// A coding tool that reads skills from a directory in the user's home.
struct Target {
    /// Display name used in output.
    label: &'static str,
    /// Directory holding all skills for this tool (`…/skills`).
    skills_dir: PathBuf,
}

pub fn run(args: AgentArgs) -> i32 {
    let result = match args.command {
        AgentCommands::Install { force, agent } => install(force, agent),
        AgentCommands::Remove { agent } => remove(agent),
    };

    match result {
        Ok(()) => 0,
        Err(error) => {
            ui::error(&error);
            1
        }
    }
}

fn install(force: bool, agent: Option<Vec<String>>) -> CommandResult {
    let targets = resolve_targets(agent)?;

    let mut installed = 0usize;
    for target in &targets {
        let dir = target.skills_dir.join(SKILL_NAME);
        match write_skill(&dir, force) {
            Ok(WriteOutcome::Written { skipped }) => {
                installed += 1;
                ui::success(&format!("{} -> {}", target.label, dir.display()));
                for path in skipped {
                    ui::warning(&format!("  kept your edited {path} (use --force to overwrite)"));
                }
            }
            Err(error) => ui::warning_stderr(&format!("{}: {}", target.label, error)),
        }
    }

    if installed == 0 {
        return Err("Failed to install the Yaak skill anywhere".to_string());
    }

    ui::info("Restart your coding tool to pick up the skill");
    Ok(())
}

fn remove(agent: Option<Vec<String>>) -> CommandResult {
    let targets = resolve_targets(agent)?;

    let mut removed = 0usize;
    for target in &targets {
        let dir = target.skills_dir.join(SKILL_NAME);
        if !dir.exists() {
            continue;
        }

        // Delete only what we wrote and the user has not since changed. Anything they
        // edited or added is theirs, and uninstalling is not a reason to lose it.
        let manifest = read_manifest(&dir);
        let mut kept = Vec::new();
        for (relative, written) in &manifest.files {
            let path = dir.join(relative);
            match fs::read(&path) {
                Ok(on_disk) if sha256(&on_disk) == *written => {
                    if let Err(error) = fs::remove_file(&path) {
                        ui::warning_stderr(&format!(
                            "Failed to remove {}: {error}",
                            path.display()
                        ));
                    }
                }
                Ok(_) => kept.push(relative.clone()),
                Err(_) => {} // Already gone
            }
        }

        let _ = fs::remove_file(dir.join(MANIFEST_NAME));
        prune_empty_dirs(&dir);

        removed += 1;
        if dir.exists() {
            ui::success(&format!("Removed the Yaak skill from {}", dir.display()));
            for path in kept {
                ui::warning(&format!("  kept your edited {path}"));
            }
        } else {
            ui::success(&format!("Removed {}", dir.display()));
        }
    }

    if removed == 0 {
        ui::info("No Yaak skill was installed");
    }
    Ok(())
}

/// Remove empty directories depth-first, including `dir` itself when nothing is left.
fn prune_empty_dirs(dir: &Path) {
    prune_empty_dirs_below(dir);
    if is_empty_dir(dir) {
        let _ = fs::remove_dir(dir);
    }
}

/// Same, but always keeps `dir` itself.
fn prune_empty_dirs_below(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            prune_empty_dirs(&path);
        }
    }
}

fn is_empty_dir(dir: &Path) -> bool {
    fs::read_dir(dir).is_ok_and(|mut entries| entries.next().is_none())
}

enum WriteOutcome {
    Written { skipped: Vec<String> },
}

fn write_skill(dir: &Path, force: bool) -> CommandResult<WriteOutcome> {
    let previous = read_manifest(dir);
    let mut manifest =
        SkillManifest { cli_version: version::cli_version().to_string(), ..Default::default() };
    let mut skipped = Vec::new();

    for file in walk(&SKILL_DIR) {
        let relative = file.path().to_string_lossy().to_string();
        let destination = dir.join(file.path());
        let contents = file.contents();
        let digest = sha256(contents);

        // Leave a file alone when the user has changed it since we wrote it.
        if !force
            && destination.exists()
            && let Ok(on_disk) = fs::read(&destination)
            && let Some(written) = previous.files.get(&relative)
            && sha256(&on_disk) != *written
        {
            skipped.push(relative.clone());
            manifest.files.insert(relative, written.clone());
            continue;
        }

        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
        }
        fs::write(&destination, contents)
            .map_err(|e| format!("Failed to write {}: {e}", destination.display()))?;
        manifest.files.insert(relative, digest);
    }

    // Drop files an earlier version shipped that this one no longer does, so a stale
    // reference can't sit alongside the refreshed guidance. Files the user has since
    // edited are left behind and stop being tracked; they belong to them now.
    for (relative, written) in &previous.files {
        if manifest.files.contains_key(relative) {
            continue;
        }
        let path = dir.join(relative);
        if fs::read(&path).is_ok_and(|on_disk| sha256(&on_disk) == *written)
            && let Err(error) = fs::remove_file(&path)
        {
            ui::warning_stderr(&format!("Failed to remove stale {}: {error}", path.display()));
        }
    }
    prune_empty_dirs_below(dir);

    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("Failed to serialize skill manifest: {e}"))?;
    fs::write(dir.join(MANIFEST_NAME), manifest_json)
        .map_err(|e| format!("Failed to write skill manifest: {e}"))?;

    Ok(WriteOutcome::Written { skipped })
}

fn read_manifest(dir: &Path) -> SkillManifest {
    fs::read_to_string(dir.join(MANIFEST_NAME))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// Flatten the embedded skill directory into its files, recursing into subdirectories.
fn walk<'a>(dir: &'a Dir<'a>) -> Vec<&'a include_dir::File<'a>> {
    let mut files: Vec<_> = dir.files().collect();
    for child in dir.dirs() {
        files.extend(walk(child));
    }
    files
}

/// `~/.agents/skills` is the cross-tool location and is always written. Tool-specific
/// directories are written only when that tool is already set up on this machine, so
/// installing never creates a config directory for a tool the user does not use.
fn resolve_targets(requested: Option<Vec<String>>) -> CommandResult<Vec<Target>> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;

    let known: Vec<(&str, PathBuf, PathBuf)> = vec![
        ("agents", home.join(".agents"), home.join(".agents").join("skills")),
        ("claude-code", home.join(".claude"), home.join(".claude").join("skills")),
        ("cursor", home.join(".cursor"), home.join(".cursor").join("skills")),
        ("codex", home.join(".codex"), home.join(".codex").join("skills")),
        ("opencode", home.join(".opencode"), home.join(".opencode").join("skills")),
    ];

    if let Some(requested) = requested {
        let mut targets = Vec::new();
        for name in requested {
            let found =
                known.iter().find(|(label, _, _)| *label == name.as_str()).ok_or_else(|| {
                    let names: Vec<_> = known.iter().map(|(l, _, _)| *l).collect();
                    format!("Unknown agent '{name}'. Known agents: {}", names.join(", "))
                })?;
            targets.push(Target { label: found.0, skills_dir: found.2.clone() });
        }
        return Ok(targets);
    }

    let targets: Vec<Target> = known
        .into_iter()
        .filter(|(label, marker, _)| *label == "agents" || marker.exists())
        .map(|(label, _, skills_dir)| Target { label, skills_dir })
        .collect();

    Ok(targets)
}
