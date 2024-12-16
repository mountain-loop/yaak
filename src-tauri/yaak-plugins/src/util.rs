use rand::distributions::{Alphanumeric, DistString};

pub fn gen_id() -> String {
    Alphanumeric.sample_string(&mut rand::thread_rng(), 5)
}
