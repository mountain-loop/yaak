use encoding_rs::SHIFT_JIS;
use tokio::fs;
use yaak_models::models::HttpResponse;

pub async fn read_response_body<'a>(
    response: HttpResponse,
) -> Option<String> {
    let body_path = match response.body_path {
        None => return None,
        Some(p) => p,
    };

    let body = fs::read(body_path).await.unwrap();
    let (s, _, _) = SHIFT_JIS.decode(body.as_slice());
    Some(s.to_string())
}
