use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

pub struct TestHttpServer {
    pub url: String,
    addr: SocketAddr,
    shutdown: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}

impl TestHttpServer {
    pub fn spawn_ok(body: &'static str) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("Failed to bind test HTTP server");
        let addr = listener.local_addr().expect("Failed to get local addr");
        let url = format!("http://{addr}/test");
        listener.set_nonblocking(true).expect("Failed to set test server listener nonblocking");

        let shutdown = Arc::new(AtomicBool::new(false));
        let shutdown_signal = Arc::clone(&shutdown);
        let body_bytes = body.as_bytes().to_vec();

        let handle = thread::spawn(move || {
            while !shutdown_signal.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
                        let mut request_buf = [0u8; 4096];
                        let _ = stream.read(&mut request_buf);

                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            body_bytes.len()
                        );
                        let _ = stream.write_all(response.as_bytes());
                        let _ = stream.write_all(&body_bytes);
                        let _ = stream.flush();
                        break;
                    }
                    Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });

        Self { url, addr, shutdown, handle: Some(handle) }
    }
}

impl Drop for TestHttpServer {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        let _ = TcpStream::connect(self.addr);

        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}
