use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::task::{Context, Poll};

use bytes::Bytes;
use hyper::upgrade::OnUpgrade;
use hyper_util::rt::TokioIo;
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt, ReadBuf, copy_bidirectional};
use tokio::net::TcpStream;

/// Copies bytes both ways between `client` and `target` (`host:port`), after sending `prefix`
/// (bytes already read from the client) upstream.
pub(crate) async fn tunnel<S>(client: S, target: &str, prefix: &[u8]) -> io::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    // Private Relay sends public port-80 connections into the system proxy, which may be this
    // engine.
    #[cfg(target_os = "macos")]
    if let Some((host, "80")) = target.rsplit_once(':') {
        return tunnel_skipping_proxy(client, host, 80, prefix).await;
    }
    relay(client, TcpStream::connect(target).await?, prefix).await
}

/// Whether a tunnel to `target` (`host:port`) would be one of the engine's own connections that
/// came back through the system proxy, which [`tunnel`] refuses. Only port 80 on macOS can be.
pub(crate) async fn is_own_connection(target: &str) -> bool {
    #[cfg(target_os = "macos")]
    if let Some((host, "80")) = target.rsplit_once(':') {
        let host = host.trim_start_matches('[').trim_end_matches(']');
        return crate::nw::is_own_fallback(host, 80).await;
    }
    let _ = target;
    false
}

/// A stream that counts the bytes read from it and written to it, for a tunnel's sizes.
pub(crate) struct Counted<S> {
    inner: S,
    read: Arc<AtomicU64>,
    written: Arc<AtomicU64>,
}

impl<S> Counted<S> {
    pub(crate) fn new(inner: S) -> Self {
        Self { inner, read: Arc::default(), written: Arc::default() }
    }

    /// The counts of bytes read and written, which keep counting after the stream moves on.
    pub(crate) fn counters(&self) -> (Arc<AtomicU64>, Arc<AtomicU64>) {
        (self.read.clone(), self.written.clone())
    }
}

impl<S: AsyncRead + Unpin> AsyncRead for Counted<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let before = buf.filled().len();
        let polled = Pin::new(&mut self.inner).poll_read(cx, buf);
        let n = buf.filled().len() - before;
        self.read.fetch_add(n as u64, Ordering::Relaxed);
        polled
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for Counted<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        let polled = Pin::new(&mut self.inner).poll_write(cx, buf);
        if let Poll::Ready(Ok(n)) = &polled {
            self.written.fetch_add(*n as u64, Ordering::Relaxed);
        }
        polled
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

/// [`tunnel`] through Network.framework, which can skip the system proxy. When it can't, it falls
/// back to the system proxy with a `CONNECT` that arrives here, and tunneling that out the same
/// way would repeat it.
#[cfg(target_os = "macos")]
async fn tunnel_skipping_proxy<S>(client: S, host: &str, port: u16, prefix: &[u8]) -> io::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if crate::nw::is_own_fallback(host, port).await {
        return Err(io::Error::other(format!(
            "not tunneling Yaak Proxy's own connection to {host}:{port} back out"
        )));
    }
    relay(client, crate::nw::connect(host, port).await?, prefix).await
}

async fn relay<S, U>(mut client: S, mut upstream: U, prefix: &[u8]) -> io::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
    U: AsyncRead + AsyncWrite + Unpin,
{
    upstream.write_all(prefix).await?;
    copy_bidirectional(&mut client, &mut upstream).await?;
    Ok(())
}

/// Joins the two halves of an HTTP upgrade once both sides have switched protocols.
pub(crate) async fn splice(client: OnUpgrade, upstream: OnUpgrade) -> io::Result<()> {
    let (client, upstream) = tokio::try_join!(client, upstream).map_err(io::Error::other)?;
    copy_bidirectional(&mut TokioIo::new(client), &mut TokioIo::new(upstream)).await?;
    Ok(())
}

/// A stream that replays bytes already read from it before reading further.
pub(crate) struct Rewind<S> {
    prefix: Bytes,
    inner: S,
}

impl<S> Rewind<S> {
    pub(crate) fn new(prefix: Bytes, inner: S) -> Self {
        Self { prefix, inner }
    }
}

impl<S: AsyncRead + Unpin> AsyncRead for Rewind<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        if !self.prefix.is_empty() {
            let n = self.prefix.len().min(buf.remaining());
            buf.put_slice(&self.prefix.split_to(n));
            return Poll::Ready(Ok(()));
        }
        Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for Rewind<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }

    fn poll_write_vectored(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bufs: &[io::IoSlice<'_>],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write_vectored(cx, bufs)
    }

    fn is_write_vectored(&self) -> bool {
        self.inner.is_write_vectored()
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use std::time::Duration;

    use tokio::io::{AsyncReadExt, duplex};
    use tokio::net::TcpListener;

    use super::*;

    /// A port-80 tunnel on macOS goes through Network.framework: the prefix goes first, bytes
    /// cross both ways, and each side's close reaches the other.
    #[tokio::test(flavor = "multi_thread")]
    async fn tunnel_skipping_proxy_relays_both_ways_and_closes() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let (mut read, mut write) = socket.split();
            tokio::io::copy(&mut read, &mut write).await.unwrap();
            write.shutdown().await.unwrap();
        });

        let (client, proxy_side) = duplex(1024);
        let tunnel = tokio::spawn(async move {
            tunnel_skipping_proxy(proxy_side, "localhost", port, b"first,").await
        });

        let payload: Vec<u8> = (0..300_000).map(|i| (i % 251) as u8).collect();
        let (mut read, mut write) = tokio::io::split(client);
        let (echoed, ()) = tokio::join!(
            async {
                let mut echoed = Vec::new();
                read.read_to_end(&mut echoed).await.unwrap();
                echoed
            },
            async {
                write.write_all(&payload).await.unwrap();
                write.shutdown().await.unwrap();
            },
        );
        assert_eq!(&echoed[..6], b"first,");
        assert!(echoed[6..] == payload[..], "echoed bytes differ from the payload");
        let ended = tokio::time::timeout(Duration::from_secs(10), tunnel).await;
        ended.expect("the tunnel stayed open").unwrap().unwrap();
    }
}
