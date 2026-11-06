use crate::data::{self, Post};
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// Posts as each client sees them. A client that has never written reads the sample data; its
/// first write takes a private copy, which is thrown away `reset_after` later. Nothing one
/// client writes is ever served to another.
pub struct PostStore {
    clients: Mutex<HashMap<IpAddr, ClientPosts>>,
    reset_after: Duration,
    max_clients: usize,
    pub max_posts: usize,
}

pub struct ClientPosts {
    pub posts: Vec<Post>,
    next_id: u64,
    created: Instant,
}

impl ClientPosts {
    pub fn insert(&mut self, user_id: u64, title: String, body: String) -> Post {
        let post = Post { id: self.next_id, user_id, title, body };
        self.next_id += 1;
        self.posts.push(post.clone());
        post
    }
}

impl PostStore {
    pub fn new(reset_after: Duration, max_clients: usize, max_posts: usize) -> Self {
        Self { clients: Mutex::new(HashMap::new()), reset_after, max_clients, max_posts }
    }

    pub fn read<R>(&self, client: IpAddr, f: impl FnOnce(&[Post]) -> R) -> R {
        let mut clients = self.lock();
        self.drop_if_expired(&mut clients, client, Instant::now());
        match clients.get(&client) {
            Some(c) => f(&c.posts),
            None => f(data::posts()),
        }
    }

    pub fn write<R>(&self, client: IpAddr, f: impl FnOnce(&mut ClientPosts) -> R) -> R {
        let mut clients = self.lock();
        let now = Instant::now();
        self.drop_if_expired(&mut clients, client, now);

        if !clients.contains_key(&client) {
            if clients.len() >= self.max_clients {
                clients.retain(|_, c| now.duration_since(c.created) < self.reset_after);
            }
            if clients.len() >= self.max_clients
                && let Some(oldest) =
                    clients.iter().min_by_key(|(_, c)| c.created).map(|(ip, _)| *ip)
            {
                clients.remove(&oldest);
            }
            let posts = data::posts().to_vec();
            let next_id = posts.iter().map(|p| p.id).max().unwrap_or(0) + 1;
            clients.insert(client, ClientPosts { posts, next_id, created: now });
        }

        f(clients.get_mut(&client).expect("inserted above"))
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<IpAddr, ClientPosts>> {
        self.clients.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn drop_if_expired(
        &self,
        clients: &mut HashMap<IpAddr, ClientPosts>,
        client: IpAddr,
        now: Instant,
    ) {
        if clients.get(&client).is_some_and(|c| now.duration_since(c.created) >= self.reset_after) {
            clients.remove(&client);
        }
    }
}
