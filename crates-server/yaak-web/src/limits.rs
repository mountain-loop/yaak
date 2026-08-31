//! Per-client rate limiting, kept deliberately small.
//!
//! One token bucket per client IP, refilled continuously, in a mutex-guarded
//! map that is swept of idle entries as it goes. Good enough to keep one
//! caller from monopolising a hosted instance; not a substitute for whatever
//! sits in front of it in production.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

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

        // Sweep buckets that have been idle long enough to be full again; there is nothing
        // to remember about them.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_full_bucket_then_a_wait() {
        let limiter = RateLimiter::new(3);
        let ip: IpAddr = "203.0.113.5".parse().unwrap();
        assert!(limiter.check(ip).is_ok());
        assert!(limiter.check(ip).is_ok());
        assert!(limiter.check(ip).is_ok());
        let wait = limiter.check(ip).expect_err("fourth call in a burst should wait");
        assert!(wait > Duration::ZERO && wait <= Duration::from_secs(20));
    }

    #[test]
    fn clients_are_independent_and_zero_disables() {
        let limiter = RateLimiter::new(1);
        let a: IpAddr = "203.0.113.5".parse().unwrap();
        let b: IpAddr = "203.0.113.6".parse().unwrap();
        assert!(limiter.check(a).is_ok());
        assert!(limiter.check(a).is_err());
        assert!(limiter.check(b).is_ok());

        let unlimited = RateLimiter::new(0);
        for _ in 0..1000 {
            assert!(unlimited.check(a).is_ok());
        }
    }
}
