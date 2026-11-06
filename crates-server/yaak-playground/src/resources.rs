use crate::data::{self, Post, Todo, User};
use crate::error::{ApiError, ApiResult, parse_id, parse_json};
use crate::{AppState, ClientIp};
use axum::extract::rejection::BytesRejection;
use axum::extract::{Extension, Path, Query, State};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Json, Response};
use bytes::Bytes;
use serde::Deserialize;
use std::collections::HashMap;

const MAX_TITLE_CHARS: usize = 200;
const MAX_BODY_CHARS: usize = 2000;

type Params = Query<HashMap<String, String>>;

struct Filters {
    user_id: Option<u64>,
    completed: Option<bool>,
    limit: Option<usize>,
}

fn filters(params: &HashMap<String, String>) -> ApiResult<Filters> {
    fn parse<T: std::str::FromStr>(
        params: &HashMap<String, String>,
        name: &str,
        expected: &str,
    ) -> ApiResult<Option<T>> {
        params
            .get(name)
            .map(|v| {
                v.parse().map_err(|_| {
                    ApiError::bad_request(format!("Query parameter `{name}` must be {expected}"))
                })
            })
            .transpose()
    }
    Ok(Filters {
        user_id: parse(params, "userId", "a user ID")?,
        completed: parse(params, "completed", "true or false")?,
        limit: parse(params, "limit", "a number")?,
    })
}

pub async fn list_users() -> Json<&'static [User]> {
    Json(data::users())
}

pub async fn get_user(Path(id): Path<String>) -> ApiResult<Json<&'static User>> {
    let user_id = parse_id(&id, "user")?;
    data::user(user_id)
        .map(Json)
        .ok_or_else(|| ApiError::not_found(format!("No user with ID {id}")))
}

pub async fn list_todos(Query(params): Params) -> ApiResult<Json<Vec<&'static Todo>>> {
    let f = filters(&params)?;
    Ok(Json(select_todos(f.user_id, f.completed, f.limit)))
}

pub async fn list_user_todos(
    Path(id): Path<String>,
    Query(params): Params,
) -> ApiResult<Json<Vec<&'static Todo>>> {
    let user = get_user(Path(id)).await?;
    let f = filters(&params)?;
    Ok(Json(select_todos(Some(user.id), f.completed, f.limit)))
}

fn select_todos(
    user_id: Option<u64>,
    completed: Option<bool>,
    limit: Option<usize>,
) -> Vec<&'static Todo> {
    data::todos()
        .iter()
        .filter(|t| user_id.is_none_or(|id| t.user_id == id))
        .filter(|t| completed.is_none_or(|c| t.completed == c))
        .take(limit.unwrap_or(usize::MAX))
        .collect()
}

pub async fn list_posts(
    State(state): State<AppState>,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Query(params): Params,
) -> ApiResult<Json<Vec<Post>>> {
    let f = filters(&params)?;
    let posts = state.posts.read(ip, |posts| {
        posts
            .iter()
            .filter(|p| f.user_id.is_none_or(|id| p.user_id == id))
            .take(f.limit.unwrap_or(usize::MAX))
            .cloned()
            .collect()
    });
    Ok(Json(posts))
}

pub async fn get_post(
    State(state): State<AppState>,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Path(id): Path<String>,
) -> ApiResult<Json<Post>> {
    let post_id = parse_id(&id, "post")?;
    state
        .posts
        .read(ip, |posts| posts.iter().find(|p| p.id == post_id).cloned())
        .map(Json)
        .ok_or_else(|| post_not_found(&id))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewPost {
    user_id: u64,
    title: String,
    body: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PostPatch {
    user_id: Option<u64>,
    title: Option<String>,
    body: Option<String>,
}

pub async fn create_post(
    State(state): State<AppState>,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    body: Result<Bytes, BytesRejection>,
) -> ApiResult<Response> {
    let input: NewPost = parse_json(body)?;
    validate(input.user_id, &input.title, &input.body)?;
    let max = state.posts.max_posts;
    let post = state.posts.write(ip, |client| {
        if client.posts.len() >= max {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                format!(
                    "You can have at most {max} posts. Delete one first, or wait for the reset"
                ),
            ));
        }
        Ok(client.insert(input.user_id, input.title, input.body))
    })?;
    let location = HeaderValue::from_str(&format!("/posts/{}", post.id)).expect("ascii");
    Ok((StatusCode::CREATED, [(header::LOCATION, location)], Json(post)).into_response())
}

pub async fn replace_post(
    State(state): State<AppState>,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Path(id): Path<String>,
    body: Result<Bytes, BytesRejection>,
) -> ApiResult<Json<Post>> {
    let post_id = parse_id(&id, "post")?;
    let input: NewPost = parse_json(body)?;
    validate(input.user_id, &input.title, &input.body)?;
    state.posts.write(ip, |client| {
        let post =
            client.posts.iter_mut().find(|p| p.id == post_id).ok_or_else(|| post_not_found(&id))?;
        post.user_id = input.user_id;
        post.title = input.title;
        post.body = input.body;
        Ok(Json(post.clone()))
    })
}

pub async fn update_post(
    State(state): State<AppState>,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Path(id): Path<String>,
    body: Result<Bytes, BytesRejection>,
) -> ApiResult<Json<Post>> {
    let post_id = parse_id(&id, "post")?;
    let patch: PostPatch = parse_json(body)?;
    state.posts.write(ip, |client| {
        let post =
            client.posts.iter_mut().find(|p| p.id == post_id).ok_or_else(|| post_not_found(&id))?;
        let user_id = patch.user_id.unwrap_or(post.user_id);
        let title = patch.title.unwrap_or_else(|| post.title.clone());
        let body = patch.body.unwrap_or_else(|| post.body.clone());
        validate(user_id, &title, &body)?;
        post.user_id = user_id;
        post.title = title;
        post.body = body;
        Ok(Json(post.clone()))
    })
}

pub async fn delete_post(
    State(state): State<AppState>,
    Extension(ClientIp(ip)): Extension<ClientIp>,
    Path(id): Path<String>,
) -> ApiResult<StatusCode> {
    let post_id = parse_id(&id, "post")?;
    state.posts.write(ip, |client| {
        let index =
            client.posts.iter().position(|p| p.id == post_id).ok_or_else(|| post_not_found(&id))?;
        client.posts.remove(index);
        Ok(StatusCode::NO_CONTENT)
    })
}

fn post_not_found(id: &str) -> ApiError {
    ApiError::not_found(format!("No post with ID {id}"))
}

fn validate(user_id: u64, title: &str, body: &str) -> ApiResult<()> {
    if data::user(user_id).is_none() {
        return Err(ApiError::bad_request(format!("No user with ID {user_id}")));
    }
    if title.trim().is_empty() {
        return Err(ApiError::bad_request("`title` can't be empty"));
    }
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(ApiError::bad_request(format!(
            "`title` must be {MAX_TITLE_CHARS} characters or fewer"
        )));
    }
    if body.chars().count() > MAX_BODY_CHARS {
        return Err(ApiError::bad_request(format!(
            "`body` must be {MAX_BODY_CHARS} characters or fewer"
        )));
    }
    Ok(())
}
