//! What the app and the daemon say to each other: one JSON object per line each way, a
//! [`Request`] and its [`Response`].

use serde::{Deserialize, Serialize};

/// The lowest port the system proxy may point at: never a privileged one.
pub const MIN_PORT: u16 = 1024;

/// The longest request line read, far more than any request needs.
pub const MAX_LINE: usize = 4096;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    /// What the daemon has done to the system proxy.
    Get,
    /// Points every enabled service at `127.0.0.1:<port>`, saving the settings it replaces,
    /// and restores them once `owner_pid` exits. Off restores them now.
    Set {
        enabled: bool,
        port: u16,
        owner_pid: i32,
    },
    /// Puts back the saved settings.
    Restore,
    /// Restores, deletes the daemon's state and exits, before the app unregisters it.
    Unregister,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// The daemon has pointed the system proxy at the engine and will restore it.
    pub active: bool,
    pub port: Option<u16>,
    pub owner_pid: Option<i32>,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<Status>,
}

impl Response {
    pub fn ok(status: Status) -> Self {
        Self { ok: true, error: None, status: Some(status) }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self { ok: false, error: Some(message.into()), status: None }
    }

    pub fn into_result(self) -> Result<Status, String> {
        if self.ok {
            Ok(self.status.unwrap_or_default())
        } else {
            Err(self.error.unwrap_or_else(|| "The helper refused the request".to_string()))
        }
    }
}

/// Reads and checks one request line. The host is not a field: it is always `127.0.0.1`.
pub fn parse_request(line: &str) -> Result<Request, String> {
    let request: Request =
        serde_json::from_str(line.trim()).map_err(|e| format!("Invalid request: {e}"))?;
    if let Request::Set { enabled: true, port, owner_pid } = request {
        if port < MIN_PORT {
            return Err(format!("Port {port} is outside {MIN_PORT} to 65535"));
        }
        if owner_pid <= 0 {
            return Err(format!("Invalid owner pid {owner_pid}"));
        }
    }
    Ok(request)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_each_command() {
        assert_eq!(parse_request(r#"{"cmd":"get"}"#), Ok(Request::Get));
        assert_eq!(parse_request("{\"cmd\":\"restore\"}\n"), Ok(Request::Restore));
        assert_eq!(parse_request(r#"{"cmd":"unregister"}"#), Ok(Request::Unregister));
        assert_eq!(
            parse_request(r#"{"cmd":"set","enabled":true,"port":9090,"owner_pid":42}"#),
            Ok(Request::Set { enabled: true, port: 9090, owner_pid: 42 })
        );
    }

    #[test]
    fn refuses_ports_outside_1024_to_65535() {
        for port in [0, 80, 1023] {
            let line = format!(r#"{{"cmd":"set","enabled":true,"port":{port},"owner_pid":42}}"#);
            assert!(parse_request(&line).is_err(), "port {port}");
        }
        assert!(
            parse_request(r#"{"cmd":"set","enabled":true,"port":65536,"owner_pid":42}"#).is_err()
        );
        assert!(parse_request(r#"{"cmd":"set","enabled":true,"port":-1,"owner_pid":42}"#).is_err());
        assert!(
            parse_request(r#"{"cmd":"set","enabled":true,"port":1024,"owner_pid":42}"#).is_ok()
        );
        assert!(
            parse_request(r#"{"cmd":"set","enabled":true,"port":65535,"owner_pid":42}"#).is_ok()
        );
    }

    #[test]
    fn refuses_a_host() {
        let line = r#"{"cmd":"set","enabled":true,"port":9090,"owner_pid":42,"host":"10.0.0.1"}"#;
        assert!(parse_request(line).unwrap_err().contains("host"));
    }

    #[test]
    fn refuses_a_bad_owner_and_junk() {
        assert!(
            parse_request(r#"{"cmd":"set","enabled":true,"port":9090,"owner_pid":0}"#).is_err()
        );
        assert!(parse_request(r#"{"cmd":"set","enabled":true,"port":9090}"#).is_err());
        assert!(parse_request(r#"{"cmd":"rm -rf"}"#).is_err());
        assert!(parse_request("not json").is_err());
        assert!(parse_request("").is_err());
    }

    #[test]
    fn turning_off_needs_no_valid_port() {
        // Off restores whatever the daemon saved; the port only widens what counts as ours.
        assert!(parse_request(r#"{"cmd":"set","enabled":false,"port":0,"owner_pid":0}"#).is_ok());
    }

    #[test]
    fn responses_round_trip() {
        let ok = Response::ok(Status {
            active: true,
            port: Some(9090),
            owner_pid: Some(1),
            version: "1".into(),
        });
        let line = serde_json::to_string(&ok).unwrap();
        assert_eq!(serde_json::from_str::<Response>(&line).unwrap(), ok);
        assert_eq!(Response::error("no").into_result(), Err("no".to_string()));
    }
}
