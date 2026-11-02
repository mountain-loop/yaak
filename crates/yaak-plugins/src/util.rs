use rand::RngExt;
use rand::distr::Alphanumeric;

pub fn gen_id() -> String {
    rand::rng().sample_iter(&Alphanumeric).take(5).map(char::from).collect()
}
