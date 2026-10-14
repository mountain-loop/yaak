use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};

use bytes::Bytes;
use hyper::upgrade::OnUpgrade;
use hyper_util::rt::TokioIo;
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt, ReadBuf, copy_bidirectional};
use tokio::net::TcpStream;

/// Copies bytes both ways between `client` and `target`, after sending `prefix` (bytes already
/// read from the client) upstream.
pub(crate) async fn tunnel<S>(mut client: S, target: &str, prefix: &[u8]) -> io::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut upstream = TcpStream::connect(target).await?;
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
