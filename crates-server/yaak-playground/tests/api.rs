use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::ConnectInfo;
use axum::http::{HeaderMap, Request, StatusCode, header};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::net::SocketAddr;
use tower::ServiceExt;
use yaak_playground::{Config, router};

const ALICE: [u8; 4] = [203, 0, 113, 1];
const BOB: [u8; 4] = [203, 0, 113, 2];

fn config() -> Config {
    Config {
        host: "127.0.0.1".to_string(),
        port: 0,
        rate_limit_per_minute: 1000,
        trust_forwarded_for: false,
        reset_after_secs: 3600,
        max_clients: 10,
        max_posts_per_client: 20,
        max_request_bytes: 4096,
    }
}

struct Res {
    status: StatusCode,
    headers: HeaderMap,
    json: Value,
}

async fn call(
    app: &Router,
    client: [u8; 4],
    method: &str,
    uri: &str,
    headers: &[(&str, &str)],
    body: Option<Value>,
) -> Res {
    let mut req = Request::builder().method(method).uri(uri);
    for (name, value) in headers {
        req = req.header(*name, *value);
    }
    let body = match body {
        Some(v) => Body::from(v.to_string()),
        None => Body::empty(),
    };
    let mut req = req.body(body).unwrap();
    req.extensions_mut().insert(ConnectInfo(SocketAddr::from((client, 40000))));
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let headers = res.headers().clone();
    let bytes = to_bytes(res.into_body(), 1024 * 1024).await.unwrap();
    let json = if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap() };
    Res { status, headers, json }
}

#[tokio::test]
async fn users_and_todos() {
    let app = router(config());
    let res = call(&app, ALICE, "GET", "/users", &[], None).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.json[0]["username"], "ada");

    let res = call(&app, ALICE, "GET", "/users/2", &[], None).await;
    assert_eq!(res.json["name"], "Grace Hopper");

    for uri in ["/users/99", "/users/abc", "/users/99/todos"] {
        let res = call(&app, ALICE, "GET", uri, &[], None).await;
        assert_eq!(res.status, StatusCode::NOT_FOUND, "{uri}");
        assert!(res.json["error"].is_string());
    }

    let res = call(&app, ALICE, "GET", "/users/1/todos?completed=false&limit=1", &[], None).await;
    assert_eq!(res.json.as_array().unwrap().len(), 1);
    assert_eq!(res.json[0]["userId"], 1);
    assert_eq!(res.json[0]["completed"], false);

    let res = call(&app, ALICE, "GET", "/todos?userId=3", &[], None).await;
    assert!(res.json.as_array().unwrap().iter().all(|t| t["userId"] == 3));

    let res = call(&app, ALICE, "GET", "/todos?completed=maybe", &[], None).await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn writes_are_private_to_the_client() {
    let app = router(config());
    let new_post = json!({ "userId": 1, "title": "Hello", "body": "From Yaak" });
    let res = call(&app, ALICE, "POST", "/posts", &[], Some(new_post)).await;
    assert_eq!(res.status, StatusCode::CREATED);
    let id = res.json["id"].as_u64().unwrap();
    assert_eq!(res.headers[header::LOCATION], format!("/posts/{id}"));

    let uri = format!("/posts/{id}");
    assert_eq!(call(&app, ALICE, "GET", &uri, &[], None).await.status, StatusCode::OK);
    assert_eq!(call(&app, BOB, "GET", &uri, &[], None).await.status, StatusCode::NOT_FOUND);

    let res = call(&app, ALICE, "PATCH", &uri, &[], Some(json!({ "title": "Edited" }))).await;
    assert_eq!(res.json["title"], "Edited");
    assert_eq!(res.json["body"], "From Yaak");

    let replacement = json!({ "userId": 2, "title": "Replaced", "body": "" });
    let res = call(&app, ALICE, "PUT", &uri, &[], Some(replacement)).await;
    assert_eq!(res.json["userId"], 2);

    let res = call(&app, ALICE, "DELETE", "/posts/1", &[], None).await;
    assert_eq!(res.status, StatusCode::NO_CONTENT);
    assert_eq!(call(&app, ALICE, "GET", "/posts/1", &[], None).await.status, StatusCode::NOT_FOUND);
    assert_eq!(call(&app, BOB, "GET", "/posts/1", &[], None).await.status, StatusCode::OK);

    let res = call(&app, ALICE, "GET", "/posts?userId=2", &[], None).await;
    assert!(res.json.as_array().unwrap().iter().any(|p| p["title"] == "Replaced"));
}

#[tokio::test]
async fn invalid_posts_are_rejected() {
    let app = router(config());
    let cases = [
        json!({ "title": "No user", "body": "" }),
        json!({ "userId": 99, "title": "Unknown user", "body": "" }),
        json!({ "userId": 1, "title": "  ", "body": "" }),
        json!({ "userId": 1, "title": "x".repeat(201), "body": "" }),
    ];
    for body in cases {
        let res = call(&app, ALICE, "POST", "/posts", &[], Some(body.clone())).await;
        assert_eq!(res.status, StatusCode::BAD_REQUEST, "{body}");
        assert!(res.json["error"].is_string());
    }

    let res = call(&app, ALICE, "POST", "/posts", &[], None).await;
    assert_eq!(res.status, StatusCode::BAD_REQUEST);

    let huge = json!({ "userId": 1, "title": "Big", "body": "x".repeat(5000) });
    let res = call(&app, ALICE, "POST", "/posts", &[], Some(huge)).await;
    assert_eq!(res.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert!(res.json["error"].is_string());
}

#[tokio::test]
async fn post_cap_and_reset() {
    let app = router(Config { max_posts_per_client: 11, ..config() });
    let post = json!({ "userId": 1, "title": "One more", "body": "" });
    assert_eq!(
        call(&app, ALICE, "POST", "/posts", &[], Some(post.clone())).await.status,
        StatusCode::CREATED
    );
    assert_eq!(
        call(&app, ALICE, "POST", "/posts", &[], Some(post)).await.status,
        StatusCode::CONFLICT
    );

    let app = router(Config { reset_after_secs: 0, ..config() });
    call(&app, ALICE, "DELETE", "/posts/1", &[], None).await;
    assert_eq!(call(&app, ALICE, "GET", "/posts/1", &[], None).await.status, StatusCode::OK);
}

#[tokio::test]
async fn bearer_token_flow() {
    let app = router(config());
    let res = call(&app, ALICE, "GET", "/auth/me", &[], None).await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);
    assert_eq!(res.headers[header::WWW_AUTHENTICATE], "Bearer");

    let bad = json!({ "username": "ada", "password": "nope" });
    assert_eq!(
        call(&app, ALICE, "POST", "/auth/token", &[], Some(bad)).await.status,
        StatusCode::UNAUTHORIZED
    );

    let good = json!({ "username": "grace", "password": "yaak" });
    let res = call(&app, ALICE, "POST", "/auth/token", &[], Some(good)).await;
    assert_eq!(res.status, StatusCode::OK);
    let token = res.json["accessToken"].as_str().unwrap().to_string();

    let auth = format!("Bearer {token}");
    let res = call(&app, BOB, "GET", "/auth/me", &[("authorization", &auth)], None).await;
    assert_eq!(res.json["username"], "grace");

    let res =
        call(&app, ALICE, "GET", "/auth/me", &[("authorization", "Bearer wrong")], None).await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);

    let cookie = format!("session={token}");
    let res = call(&app, ALICE, "GET", "/auth/session", &[("cookie", &cookie)], None).await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn session_cookie_flow() {
    let app = router(config());
    let login = json!({ "username": "alan", "password": "yaak" });
    let res =
        call(&app, ALICE, "POST", "/auth/session", &[("x-forwarded-proto", "https")], Some(login))
            .await;
    assert_eq!(res.status, StatusCode::OK);
    let set_cookie = res.headers[header::SET_COOKIE].to_str().unwrap();
    assert!(set_cookie.contains("HttpOnly") && set_cookie.contains("; Secure"), "{set_cookie}");
    let cookie = set_cookie.split(';').next().unwrap().to_string();

    let headers = [("cookie", cookie.as_str())];
    let res = call(&app, ALICE, "GET", "/auth/session", &headers, None).await;
    assert_eq!(res.json["username"], "alan");

    let id = cookie.trim_start_matches("session=");
    let auth = format!("Bearer {id}");
    let res = call(&app, ALICE, "GET", "/auth/me", &[("authorization", &auth)], None).await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);

    let res = call(&app, ALICE, "DELETE", "/auth/session", &headers, None).await;
    assert_eq!(res.status, StatusCode::NO_CONTENT);
    assert!(res.headers[header::SET_COOKIE].to_str().unwrap().contains("Max-Age=0"));
    assert_eq!(
        call(&app, ALICE, "GET", "/auth/session", &headers, None).await.status,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn rate_limit() {
    let app = router(Config { rate_limit_per_minute: 2, ..config() });
    call(&app, ALICE, "GET", "/users", &[], None).await;
    call(&app, ALICE, "GET", "/users", &[], None).await;
    let res = call(&app, ALICE, "GET", "/users", &[], None).await;
    assert_eq!(res.status, StatusCode::TOO_MANY_REQUESTS);
    assert!(res.headers.contains_key(header::RETRY_AFTER));
    assert_eq!(call(&app, BOB, "GET", "/users", &[], None).await.status, StatusCode::OK);
}

#[tokio::test]
async fn openapi_matches_the_routes() {
    let app = router(config());
    let spec = call(&app, ALICE, "GET", "/openapi.json", &[], None).await.json;
    let mut documented = BTreeSet::new();
    for (path, item) in spec["paths"].as_object().unwrap() {
        for (method, _) in item.as_object().unwrap() {
            let method = method.to_uppercase();
            let uri = path.replace("{id}", "1");
            // A fresh client per call, so a DELETE can't hide the GET that follows it
            let client = [198, 51, 100, documented.len() as u8];
            let res = call(&app, client, &method, &uri, &[], None).await;
            assert!(
                res.status != StatusCode::NOT_FOUND && res.status != StatusCode::METHOD_NOT_ALLOWED,
                "{method} {path} is documented but not routed ({})",
                res.status
            );
            documented.insert(format!("{method} {path}"));
        }
    }

    let index = call(&app, ALICE, "GET", "/", &[], None).await.json;
    let listed: BTreeSet<String> = index["endpoints"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e.as_str().unwrap().to_string())
        .collect();
    assert_eq!(listed, documented);

    assert_eq!(call(&app, ALICE, "GET", "/nope", &[], None).await.status, StatusCode::NOT_FOUND);
}
