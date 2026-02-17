use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

pub struct TestHttpServer {
    pub url: String,
    handle: Option<thread::JoinHandle<()>>,
}

impl TestHttpServer {
    pub fn spawn_ok(body: &'static str) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("Failed to bind test HTTP server");
        let addr = listener.local_addr().expect("Failed to get local addr");
        let url = format!("http://{addr}/test");
        let body_bytes = body.as_bytes().to_vec();

        let handle = thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut request_buf = [0u8; 4096];
                let _ = stream.read(&mut request_buf);

                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body_bytes.len()
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.write_all(&body_bytes);
                let _ = stream.flush();
            }
        });

        Self { url, handle: Some(handle) }
    }
}

impl Drop for TestHttpServer {
    fn drop(&mut self) {
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}
