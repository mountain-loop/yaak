use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: u64,
    pub name: String,
    pub username: String,
    pub email: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Post {
    pub id: u64,
    pub user_id: u64,
    pub title: String,
    pub body: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: u64,
    pub user_id: u64,
    pub title: String,
    pub completed: bool,
}

#[derive(Deserialize)]
struct Seed {
    users: Vec<User>,
    posts: Vec<Post>,
    todos: Vec<Todo>,
}

static SEED: LazyLock<Seed> =
    LazyLock::new(|| serde_json::from_str(include_str!("seed.json")).expect("valid seed.json"));

pub fn users() -> &'static [User] {
    &SEED.users
}

pub fn posts() -> &'static [Post] {
    &SEED.posts
}

pub fn todos() -> &'static [Todo] {
    &SEED.todos
}

pub fn user(id: u64) -> Option<&'static User> {
    users().iter().find(|u| u.id == id)
}

pub fn user_by_username(username: &str) -> Option<&'static User> {
    users().iter().find(|u| u.username == username)
}
