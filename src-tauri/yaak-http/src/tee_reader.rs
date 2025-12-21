use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, ReadBuf};
use tokio::sync::mpsc;

/// A reader that forwards all read data to a channel while also returning it to the caller.
/// This allows capturing request body data as it's being sent.
pub struct TeeReader<R> {
    inner: R,
    tx: mpsc::UnboundedSender<Vec<u8>>,
}

impl<R> TeeReader<R> {
    pub fn new(inner: R, tx: mpsc::UnboundedSender<Vec<u8>>) -> Self {
        Self { inner, tx }
    }
}

impl<R: AsyncRead + Unpin> AsyncRead for TeeReader<R> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let before_len = buf.filled().len();

        match Pin::new(&mut self.inner).poll_read(cx, buf) {
            Poll::Ready(Ok(())) => {
                let after_len = buf.filled().len();
                if after_len > before_len {
                    // Data was read, send a copy to the channel
                    let data = buf.filled()[before_len..after_len].to_vec();
                    // Ignore send errors - receiver might have been dropped
                    let _ = self.tx.send(data);
                }
                Poll::Ready(Ok(()))
            }
            Poll::Ready(Err(e)) => Poll::Ready(Err(e)),
            Poll::Pending => Poll::Pending,
        }
    }
}
