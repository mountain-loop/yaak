use crate::cli::{AuthArgs, AuthCommands};
use crate::ui;
use base64::Engine as _;
use keyring::Entry;
use rand::RngCore;
use rand::rngs::OsRng;
use reqwest::Url;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::{self, IsTerminal, Write};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const OAUTH_CLIENT_ID: &str = "a1fe44800c2d7e803cad1b4bf07a291c";
const KEYRING_USER: &str = "yaak";
const AUTH_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_REQUEST_BYTES: usize = 16 * 1024;

type CommandResult<T = ()> = std::result::Result<T, String>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Environment {
    Production,
    Staging,
    Development,
}

impl Environment {
    fn app_base_url(self) -> &'static str {
        match self {
            Environment::Production => "https://yaak.app",
            Environment::Staging => "https://todo.yaak.app",
            Environment::Development => "http://localhost:9444",
        }
    }

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

struct OAuthFlow {
    app_base_url: String,
    auth_url: Url,
    token_url: String,
    redirect_url: String,
    state: String,
    code_verifier: String,
}

pub async fn run(args: AuthArgs) -> i32 {
    let result = match args.command {
        AuthCommands::Login => login().await,
        AuthCommands::Logout => logout(),
        AuthCommands::Whoami => whoami().await,
    };

    match result {
        Ok(()) => 0,
        Err(error) => {
            ui::error(&error);
            1
        }
    }
}

async fn login() -> CommandResult {
    let environment = current_environment();

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to start OAuth callback server: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to determine callback server port: {e}"))?
        .port();

    let oauth = build_oauth_flow(environment, port)?;

    ui::info(&format!("Initiating login to {}", oauth.auth_url));
    if !confirm_open_browser()? {
        ui::info("Login canceled");
        return Ok(());
    }

    if let Err(err) = webbrowser::open(oauth.auth_url.as_ref()) {
        ui::warning(&format!("Failed to open browser: {err}"));
        ui::info(&format!("Open this URL manually:\n{}", oauth.auth_url));
    }
    ui::info("Waiting for authentication...");

    let code = tokio::select! {
        result = receive_oauth_code(listener, &oauth.state, &oauth.app_base_url) => result?,
        _ = tokio::signal::ctrl_c() => {
            return Err("Interrupted by user".to_string());
        }
        _ = tokio::time::sleep(AUTH_TIMEOUT) => {
            return Err("Timeout waiting for authentication".to_string());
        }
    };

    let token = exchange_access_token(&oauth, &code).await?;
    store_auth_token(environment, &token)?;
    ui::success("Authentication successful!");
    Ok(())
}

fn logout() -> CommandResult {
    delete_auth_token(current_environment())?;
    ui::success("Signed out of Yaak");
    Ok(())
}

async fn whoami() -> CommandResult {
    let environment = current_environment();
    let token = match get_auth_token(environment)? {
        Some(token) => token,
        None => {
            ui::warning("Not logged in");
            ui::info("Please run `yaak auth login`");
            return Ok(());
        }
    };

    let url = format!("{}/api/v1/whoami", environment.api_base_url());
    let response = reqwest::Client::new()
        .get(url)
        .header("X-Yaak-Session", token)
        .header(reqwest::header::USER_AGENT, user_agent())
        .send()
        .await
        .map_err(|e| format!("Failed to call whoami endpoint: {e}"))?;

    let status = response.status();
    let body =
        response.text().await.map_err(|e| format!("Failed to read whoami response body: {e}"))?;

    if !status.is_success() {
        if status.as_u16() == 401 {
            let _ = delete_auth_token(environment);
            return Err(
                "Unauthorized to access CLI. Run `yaak auth login` to refresh credentials."
                    .to_string(),
            );
        }
        return Err(parse_api_error(status.as_u16(), &body));
    }

    println!("{body}");
    Ok(())
}

fn current_environment() -> Environment {
    let value = std::env::var("ENVIRONMENT").ok();
    parse_environment(value.as_deref())
}

fn parse_environment(value: Option<&str>) -> Environment {
    match value {
        Some("staging") => Environment::Staging,
        Some("development") => Environment::Development,
        _ => Environment::Production,
    }
}

fn build_oauth_flow(environment: Environment, callback_port: u16) -> CommandResult<OAuthFlow> {
    let code_verifier = random_hex(32);
    let state = random_hex(24);
    let redirect_url = format!("http://127.0.0.1:{callback_port}/oauth/callback");

    let code_challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(Sha256::digest(code_verifier.as_bytes()));

    let mut auth_url = Url::parse(&format!("{}/login/oauth/authorize", environment.app_base_url()))
        .map_err(|e| format!("Failed to build OAuth authorize URL: {e}"))?;
    auth_url
        .query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", OAUTH_CLIENT_ID)
        .append_pair("redirect_uri", &redirect_url)
        .append_pair("state", &state)
        .append_pair("code_challenge_method", "S256")
        .append_pair("code_challenge", &code_challenge);

    Ok(OAuthFlow {
        app_base_url: environment.app_base_url().to_string(),
        auth_url,
        token_url: format!("{}/login/oauth/access_token", environment.app_base_url()),
        redirect_url,
        state,
        code_verifier,
    })
}

async fn receive_oauth_code(
    listener: TcpListener,
    expected_state: &str,
    app_base_url: &str,
) -> CommandResult<String> {
    loop {
        let (mut stream, _) = listener
            .accept()
            .await
            .map_err(|e| format!("OAuth callback server accept error: {e}"))?;

        match parse_callback_request(&mut stream).await {
            Ok((state, code)) => {
                if state != expected_state {
                    let _ = write_bad_request(&mut stream, "Invalid OAuth state").await;
                    continue;
                }

                let success_redirect = format!("{app_base_url}/login/oauth/success");
                write_redirect(&mut stream, &success_redirect)
                    .await
                    .map_err(|e| format!("Failed responding to OAuth callback: {e}"))?;
                return Ok(code);
            }
            Err(error) => {
                let _ = write_bad_request(&mut stream, &error).await;
                if error.starts_with("OAuth provider returned error:") {
                    return Err(error);
                }
            }
        }
    }
}

async fn parse_callback_request(stream: &mut TcpStream) -> CommandResult<(String, String)> {
    let target = read_http_target(stream).await?;
    if !target.starts_with("/oauth/callback") {
        return Err("Expected /oauth/callback path".to_string());
    }

    let url = Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|e| format!("Failed to parse callback URL: {e}"))?;
    let mut state: Option<String> = None;
    let mut code: Option<String> = None;
    let mut oauth_error: Option<String> = None;
    let mut oauth_error_description: Option<String> = None;

    for (k, v) in url.query_pairs() {
        if k == "state" {
            state = Some(v.into_owned());
        } else if k == "code" {
            code = Some(v.into_owned());
        } else if k == "error" {
            oauth_error = Some(v.into_owned());
        } else if k == "error_description" {
            oauth_error_description = Some(v.into_owned());
        }
    }

    if let Some(error) = oauth_error {
        let mut message = format!("OAuth provider returned error: {error}");
        if let Some(description) = oauth_error_description.filter(|d| !d.is_empty()) {
            message.push_str(&format!(" ({description})"));
        }
        return Err(message);
    }

    let state = state.ok_or_else(|| "Missing 'state' query parameter".to_string())?;
    let code = code.ok_or_else(|| "Missing 'code' query parameter".to_string())?;

    if code.is_empty() {
        return Err("Missing 'code' query parameter".to_string());
    }

    Ok((state, code))
}

async fn read_http_target(stream: &mut TcpStream) -> CommandResult<String> {
    let mut buf = vec![0_u8; MAX_REQUEST_BYTES];
    let mut total_read = 0_usize;

    loop {
        let n = stream
            .read(&mut buf[total_read..])
            .await
            .map_err(|e| format!("Failed reading callback request: {e}"))?;
        if n == 0 {
            break;
        }
        total_read += n;

        if buf[..total_read].windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }

        if total_read == MAX_REQUEST_BYTES {
            return Err("OAuth callback request too large".to_string());
        }
    }

    let req = String::from_utf8_lossy(&buf[..total_read]);
    let request_line =
        req.lines().next().ok_or_else(|| "Invalid callback request line".to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();

    if method != "GET" {
        return Err(format!("Expected GET callback request, got '{method}'"));
    }
    if target.is_empty() {
        return Err("Missing callback request target".to_string());
    }

    Ok(target.to_string())
}

async fn write_bad_request(stream: &mut TcpStream, message: &str) -> std::io::Result<()> {
    let body = format!("Failed to authenticate: {message}");
    let response = format!(
        "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream.write_all(response.as_bytes()).await?;
    stream.shutdown().await
}

async fn write_redirect(stream: &mut TcpStream, location: &str) -> std::io::Result<()> {
    let response = format!(
        "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(response.as_bytes()).await?;
    stream.shutdown().await
}

async fn exchange_access_token(oauth: &OAuthFlow, code: &str) -> CommandResult<String> {
    let response = reqwest::Client::new()
        .post(&oauth.token_url)
        .header(reqwest::header::USER_AGENT, user_agent())
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", OAUTH_CLIENT_ID),
            ("code", code),
            ("redirect_uri", oauth.redirect_url.as_str()),
            ("code_verifier", oauth.code_verifier.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to exchange OAuth code for access token: {e}"))?;

    let status = response.status();
    let body =
        response.text().await.map_err(|e| format!("Failed to read token response body: {e}"))?;

    if !status.is_success() {
        return Err(format!(
            "Failed to fetch access token: status={} body={}",
            status.as_u16(),
            body
        ));
    }

    let parsed: Value =
        serde_json::from_str(&body).map_err(|e| format!("Invalid token response JSON: {e}"))?;
    let token = parsed
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("Token response missing access_token: {body}"))?;

    Ok(token.to_string())
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

fn store_auth_token(environment: Environment, token: &str) -> CommandResult {
    let entry = keyring_entry(environment)?;
    entry.set_password(token).map_err(|e| format!("Failed to store auth token: {e}"))
}

fn delete_auth_token(environment: Environment) -> CommandResult {
    let entry = keyring_entry(environment)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("Failed to delete auth token: {err}")),
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

fn random_hex(bytes: usize) -> String {
    let mut data = vec![0_u8; bytes];
    OsRng.fill_bytes(&mut data);
    hex::encode(data)
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

fn confirm_open_browser() -> CommandResult<bool> {
    if !io::stdin().is_terminal() {
        return Ok(true);
    }

    loop {
        print!("Open default browser? [Y/n]: ");
        io::stdout().flush().map_err(|e| format!("Failed to flush stdout: {e}"))?;

        let mut input = String::new();
        io::stdin().read_line(&mut input).map_err(|e| format!("Failed to read input: {e}"))?;

        match input.trim().to_ascii_lowercase().as_str() {
            "" | "y" | "yes" => return Ok(true),
            "n" | "no" => return Ok(false),
            _ => ui::warning("Please answer y or n"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn environment_mapping() {
        assert_eq!(parse_environment(Some("staging")), Environment::Staging);
        assert_eq!(parse_environment(Some("development")), Environment::Development);
        assert_eq!(parse_environment(Some("production")), Environment::Production);
        assert_eq!(parse_environment(None), Environment::Production);
    }

    #[tokio::test]
    async fn parses_callback_request() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("local addr");

        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept");
            parse_callback_request(&mut stream).await
        });

        let mut client = TcpStream::connect(addr).await.expect("connect");
        client
            .write_all(
                b"GET /oauth/callback?code=abc123&state=xyz HTTP/1.1\r\nHost: localhost\r\n\r\n",
            )
            .await
            .expect("write");

        let parsed = server.await.expect("join").expect("parse");
        assert_eq!(parsed.0, "xyz");
        assert_eq!(parsed.1, "abc123");
    }

    #[tokio::test]
    async fn parse_callback_request_oauth_error() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("local addr");

        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.expect("accept");
            parse_callback_request(&mut stream).await
        });

        let mut client = TcpStream::connect(addr).await.expect("connect");
        client
            .write_all(
                b"GET /oauth/callback?error=access_denied&error_description=User%20denied&state=xyz HTTP/1.1\r\nHost: localhost\r\n\r\n",
            )
            .await
            .expect("write");

        let err = server.await.expect("join").expect_err("should fail");
        assert!(err.contains("OAuth provider returned error: access_denied"));
        assert!(err.contains("User denied"));
    }

    #[tokio::test]
    async fn receive_oauth_code_fails_fast_on_provider_error() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("local addr");

        let server = tokio::spawn(async move {
            receive_oauth_code(listener, "expected-state", "http://localhost:9444").await
        });

        let mut client = TcpStream::connect(addr).await.expect("connect");
        client
            .write_all(
                b"GET /oauth/callback?error=access_denied&state=expected-state HTTP/1.1\r\nHost: localhost\r\n\r\n",
            )
            .await
            .expect("write");

        let result = tokio::time::timeout(std::time::Duration::from_secs(2), server)
            .await
            .expect("should not timeout")
            .expect("join");
        let err = result.expect_err("should return oauth error");
        assert!(err.contains("OAuth provider returned error: access_denied"));
    }

    #[test]
    fn builds_oauth_flow_with_pkce() {
        let flow = build_oauth_flow(Environment::Development, 8080).expect("flow");
        assert!(flow.auth_url.as_str().contains("code_challenge_method=S256"));
        assert!(
            flow.auth_url
                .as_str()
                .contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A8080%2Foauth%2Fcallback")
        );
        assert_eq!(flow.redirect_url, "http://127.0.0.1:8080/oauth/callback");
        assert_eq!(flow.token_url, "http://localhost:9444/login/oauth/access_token");
    }
}
