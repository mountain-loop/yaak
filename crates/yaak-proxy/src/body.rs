use std::pin::Pin;
use std::sync::mpsc as std_mpsc;
use std::task::{Context, Poll};
use std::time::Instant;

use bytes::Bytes;
use hyper::body::{Body, Frame};

use crate::ProxyEvent;

/// A body wrapper that emits `ResponseBodyChunk` per frame and
/// `ResponseBodyComplete` when the stream finishes.
pub struct MeasuredBody<B> {
    inner: B,
    request_id: u64,
    bytes_count: u64,
    chunks: Vec<Bytes>,
    event_tx: std_mpsc::Sender<ProxyEvent>,
    start: Instant,
    finished: bool,
}

impl<B> MeasuredBody<B> {
    pub fn new(
        inner: B,
        request_id: u64,
        start: Instant,
        event_tx: std_mpsc::Sender<ProxyEvent>,
    ) -> Self {
        Self {
            inner,
            request_id,
            bytes_count: 0,
            chunks: Vec::new(),
            event_tx,
            start,
            finished: false,
        }
    }

    fn send_complete(&mut self) {
        if !self.finished {
            self.finished = true;
            let body = if self.chunks.is_empty() {
                None
            } else {
                let mut buf = Vec::with_capacity(self.bytes_count as usize);
                for chunk in self.chunks.drain(..) {
                    buf.extend_from_slice(&chunk);
                }
                Some(buf)
            };
            let _ = self.event_tx.send(ProxyEvent::ResponseBodyComplete {
                id: self.request_id,
                body,
                size: self.bytes_count,
                elapsed_ms: self.start.elapsed().as_millis() as u64,
            });
        }
    }
}

impl<B> Body for MeasuredBody<B>
where
    B: Body<Data = Bytes> + Unpin,
    B::Error: std::error::Error + Send + Sync + 'static,
{
    type Data = Bytes;
    type Error = B::Error;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Self::Data>, Self::Error>>> {
        let inner = Pin::new(&mut self.inner);
        match inner.poll_frame(cx) {
            Poll::Ready(Some(Ok(frame))) => {
                if let Some(data) = frame.data_ref() {
                    let len = data.len();
                    self.bytes_count += len as u64;
                    self.chunks.push(data.clone());
                    let _ = self
                        .event_tx
                        .send(ProxyEvent::ResponseBodyChunk { id: self.request_id, bytes: len });
                }
                Poll::Ready(Some(Ok(frame)))
            }
            Poll::Ready(Some(Err(e))) => {
                self.send_complete();
                Poll::Ready(Some(Err(e)))
            }
            Poll::Ready(None) => {
                self.send_complete();
                Poll::Ready(None)
            }
            Poll::Pending => Poll::Pending,
        }
    }

    fn is_end_stream(&self) -> bool {
        self.inner.is_end_stream()
    }

    fn size_hint(&self) -> hyper::body::SizeHint {
        self.inner.size_hint()
    }
}

impl<B> Drop for MeasuredBody<B> {
    fn drop(&mut self) {
        self.send_complete();
    }
}
