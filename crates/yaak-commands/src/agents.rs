//! Which of the Agents pane's setup steps are already done on this machine.
//!
//! Detection reads the files the agents keep their MCP servers in and the
//! skills directory `yaak agent install` writes to. A missing or unparsable
//! file is "not detected", never an error: the pane shows a done mark when it
//! can, and the command when it cannot.

use serde_json::Value;
use std::path::{Path, PathBuf};
use yaak_rpc_schema::{AgentClient, AgentSetupStatus};

const SKILL_NAME: &str = "use-yaak";
const SERVER_NAME: &str = "yaak";

pub fn agent_setup_status(home: &Path, agent: AgentClient) -> AgentSetupStatus {
    AgentSetupStatus { mcp_server: mcp_server_added(home, agent), skill: skill_installed(home, agent) }
}

fn skill_installed(home: &Path, agent: AgentClient) -> Option<bool> {
    let skills_dir = match agent {
        AgentClient::ClaudeCode => home.join(".claude").join("skills"),
        AgentClient::Codex => home.join(".codex").join("skills"),
        AgentClient::Cursor => home.join(".cursor").join("skills"),
        AgentClient::Vscode | AgentClient::Other => home.join(".agents").join("skills"),
    };
    Some(skills_dir.join(SKILL_NAME).is_dir())
}

fn mcp_server_added(home: &Path, agent: AgentClient) -> Option<bool> {
    match agent {
        AgentClient::ClaudeCode => Some(claude_code_has_server(&home.join(".claude.json"))),
        AgentClient::Codex => Some(codex_has_server(&home.join(".codex").join("config.toml"))),
        AgentClient::Cursor => {
            Some(json_has_server(&home.join(".cursor").join("mcp.json"), "mcpServers"))
        }
        AgentClient::Vscode => Some(json_has_server(&vscode_user_mcp_json(home), "servers")),
        AgentClient::Other => None,
    }
}

fn vscode_user_mcp_json(home: &Path) -> PathBuf {
    let user_dir = if cfg!(target_os = "macos") {
        home.join("Library").join("Application Support").join("Code").join("User")
    } else if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Roaming"))
            .join("Code")
            .join("User")
    } else {
        home.join(".config").join("Code").join("User")
    };
    user_dir.join("mcp.json")
}

fn read_json(path: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn has_server(servers: Option<&Value>) -> bool {
    servers.and_then(|s| s.get(SERVER_NAME)).is_some_and(|v| v.is_object())
}

fn json_has_server(path: &Path, key: &str) -> bool {
    read_json(path).is_some_and(|root| has_server(root.get(key)))
}

/// `claude mcp add` writes to the top level with `-s user` and under the
/// current project's entry without it, so both count.
fn claude_code_has_server(path: &Path) -> bool {
    let Some(root) = read_json(path) else {
        return false;
    };
    if has_server(root.get("mcpServers")) {
        return true;
    }
    root.get("projects")
        .and_then(|p| p.as_object())
        .is_some_and(|projects| projects.values().any(|p| has_server(p.get("mcpServers"))))
}

/// A `[mcp_servers.yaak]` table header (or a sub-table of it), with the key
/// bare or quoted, is enough. The file is not otherwise parsed.
fn codex_has_server(path: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(path) else {
        return false;
    };
    text.lines().map(str::trim).any(is_codex_server_header)
}

fn is_codex_server_header(line: &str) -> bool {
    let Some(rest) = line.strip_prefix('[') else {
        return false;
    };
    let Some(inner) = rest.split(']').next() else {
        return false;
    };
    let mut parts = inner.split('.').map(|p| p.trim().trim_matches(|c| c == '"' || c == '\''));
    parts.next() == Some("mcp_servers") && parts.next() == Some(SERVER_NAME)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(path: &Path, contents: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }

    #[test]
    fn nothing_installed() {
        let home = tempfile::tempdir().unwrap();
        for agent in
            [AgentClient::ClaudeCode, AgentClient::Codex, AgentClient::Cursor, AgentClient::Vscode]
        {
            let status = agent_setup_status(home.path(), agent);
            assert_eq!(status.mcp_server, Some(false), "{agent:?}");
            assert_eq!(status.skill, Some(false), "{agent:?}");
        }
        let other = agent_setup_status(home.path(), AgentClient::Other);
        assert_eq!(other.mcp_server, None);
        assert_eq!(other.skill, Some(false));
    }

    #[test]
    fn skill_directories_per_agent() {
        let home = tempfile::tempdir().unwrap();
        fs::create_dir_all(home.path().join(".claude/skills/use-yaak")).unwrap();
        fs::create_dir_all(home.path().join(".agents/skills/use-yaak")).unwrap();

        assert_eq!(agent_setup_status(home.path(), AgentClient::ClaudeCode).skill, Some(true));
        assert_eq!(agent_setup_status(home.path(), AgentClient::Codex).skill, Some(false));
        assert_eq!(agent_setup_status(home.path(), AgentClient::Cursor).skill, Some(false));
        assert_eq!(agent_setup_status(home.path(), AgentClient::Vscode).skill, Some(true));
        assert_eq!(agent_setup_status(home.path(), AgentClient::Other).skill, Some(true));
    }

    #[test]
    fn claude_code_top_level_or_project_scope() {
        let home = tempfile::tempdir().unwrap();
        let path = home.path().join(".claude.json");

        write(&path, r#"{"mcpServers":{"yaak":{"command":"yaak","args":["mcp"]}}}"#);
        assert_eq!(agent_setup_status(home.path(), AgentClient::ClaudeCode).mcp_server, Some(true));

        write(
            &path,
            r#"{"projects":{"/Users/me/app":{"mcpServers":{"yaak":{"command":"yaak"}}}}}"#,
        );
        assert_eq!(agent_setup_status(home.path(), AgentClient::ClaudeCode).mcp_server, Some(true));

        write(&path, r#"{"mcpServers":{"other":{}},"projects":{"/x":{"mcpServers":{}}}}"#);
        assert_eq!(
            agent_setup_status(home.path(), AgentClient::ClaudeCode).mcp_server,
            Some(false)
        );

        write(&path, "{ not json");
        assert_eq!(
            agent_setup_status(home.path(), AgentClient::ClaudeCode).mcp_server,
            Some(false)
        );
    }

    #[test]
    fn codex_table_header() {
        let home = tempfile::tempdir().unwrap();
        let path = home.path().join(".codex/config.toml");

        write(&path, "model = \"o3\"\n\n[mcp_servers.yaak]\ncommand = \"yaak\"\nargs = [\"mcp\"]\n");
        assert_eq!(agent_setup_status(home.path(), AgentClient::Codex).mcp_server, Some(true));

        write(&path, "  [ mcp_servers . \"yaak\" ]\nurl = \"http://127.0.0.1:64343/mcp\"\n");
        assert_eq!(agent_setup_status(home.path(), AgentClient::Codex).mcp_server, Some(true));

        write(&path, "[mcp_servers.yaak.env]\nFOO = \"bar\"\n");
        assert_eq!(agent_setup_status(home.path(), AgentClient::Codex).mcp_server, Some(true));

        write(&path, "[mcp_servers.yaakish]\ncommand = \"x\"\n[mcp_servers]\n");
        assert_eq!(agent_setup_status(home.path(), AgentClient::Codex).mcp_server, Some(false));
    }

    #[test]
    fn cursor_and_vscode_json() {
        let home = tempfile::tempdir().unwrap();

        write(&home.path().join(".cursor/mcp.json"), r#"{"mcpServers":{"yaak":{"command":"yaak"}}}"#);
        assert_eq!(agent_setup_status(home.path(), AgentClient::Cursor).mcp_server, Some(true));

        write(&home.path().join(".cursor/mcp.json"), r#"{"servers":{"yaak":{}}}"#);
        assert_eq!(agent_setup_status(home.path(), AgentClient::Cursor).mcp_server, Some(false));

        if !cfg!(target_os = "windows") {
            write(
                &vscode_user_mcp_json(home.path()),
                r#"{"servers":{"yaak":{"type":"stdio","command":"yaak","args":["mcp"]}}}"#,
            );
            assert_eq!(agent_setup_status(home.path(), AgentClient::Vscode).mcp_server, Some(true));
        }
    }
}
