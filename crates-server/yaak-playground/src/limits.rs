use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// One token bucket per client IP, refilled continuously.
pub struct RateLimiter {
    per_minute: u32,
    buckets: Mutex<HashMap<IpAddr, Bucket>>,
}

struct Bucket {
    tokens: f64,
    last: Instant,
}

impl RateLimiter {
    /// `per_minute == 0` disables limiting.
    pub fn new(per_minute: u32) -> Self {
        Self { per_minute, buckets: Mutex::new(HashMap::new()) }
    }

    /// Take one token for `client`, or say how long until one is available.
    pub fn check(&self, client: IpAddr) -> Result<(), Duration> {
        if self.per_minute == 0 {
            return Ok(());
        }
        let capacity = self.per_minute as f64;
        let per_second = capacity / 60.0;
        let now = Instant::now();

        let mut buckets = self.buckets.lock().unwrap_or_else(|e| e.into_inner());
        if buckets.len() > 1024 {
            buckets.retain(|_, b| now.duration_since(b.last).as_secs_f64() * per_second < capacity);
        }

        let bucket = buckets.entry(client).or_insert(Bucket { tokens: capacity, last: now });
        let elapsed = now.duration_since(bucket.last).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * per_second).min(capacity);
        bucket.last = now;

        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            Ok(())
        } else {
            let wait = (1.0 - bucket.tokens) / per_second;
            Err(Duration::from_secs_f64(wait.max(0.001)))
        }
    }
}
