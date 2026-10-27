use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Instant;

use bytes::Bytes;
use hyper::body::{Body, Frame, Incoming, SizeHint};

use crate::{Engine, ProxyEvent};

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Direction {
    Request,
    Response,
}

/// Streams a body through untouched, reporting each frame as a chunk event (with data up to
/// `capture_body_limit`) and the end as a completion event.
pub(crate) struct CaptureBody {
    inner: Incoming,
    direction: Direction,
    id: u64,
    start: Instant,
    engine: Arc<Engine>,
    captured: usize,
    size: u64,
    finished: bool,
}

impl CaptureBody {
    pub(crate) fn new(
        inner: Incoming,
        direction: Direction,
        id: u64,
        start: Instant,
        engine: Arc<Engine>,
    ) -> Self {
        Self { inner, direction, id, start, engine, captured: 0, size: 0, finished: false }
    }

    /// Every byte the body declared has arrived. An HTTP/2 stream's end can come in a frame after
    /// its last byte, and hyper stops polling a Content-Length body once it has written that
    /// many bytes, so the stream's end alone would call a complete body cut short.
    fn complete(&self) -> bool {
        self.inner.is_end_stream() || self.inner.size_hint().exact() == Some(0)
    }

    fn finish(&mut self, error: Option<String>) {
        if self.finished {
            return;
        }
        self.finished = true;
        let truncated = self.size > self.captured as u64;
        let event = match self.direction {
            Direction::Request if self.size == 0 => return,
            Direction::Request => {
                ProxyEvent::RequestBodyComplete { id: self.id, size: self.size, truncated }
            }
            Direction::Response => ProxyEvent::ResponseBodyComplete {
                id: self.id,
                size: self.size,
                truncated,
                elapsed_ms: self.start.elapsed().as_millis() as u64,
                error,
            },
        };
        self.engine.emit(event);
    }
}

impl Body for CaptureBody {
    type Data = Bytes;
    type Error = hyper::Error;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, hyper::Error>>> {
        let result = Pin::new(&mut self.inner).poll_frame(cx);
        match &result {
            Poll::Ready(Some(Ok(frame))) => {
                if let Some(frame_data) = frame.data_ref() {
                    let len = frame_data.len();
                    let room = self.engine.capture_body_limit.saturating_sub(self.captured);
                    let data = frame_data.slice(..len.min(room));
                    self.captured += data.len();
                    self.size += len as u64;
                    let id = self.id;
                    self.engine.emit(match self.direction {
                        Direction::Request => ProxyEvent::RequestBodyChunk { id, len, data },
                        Direction::Response => ProxyEvent::ResponseBodyChunk { id, len, data },
                    });
                }
                if self.complete() {
                    self.finish(None);
                }
            }
            Poll::Ready(Some(Err(e))) => {
                let error = e.to_string();
                self.finish(Some(error));
            }
            Poll::Ready(None) => self.finish(None),
            Poll::Pending => {}
        }
        result
    }

    fn is_end_stream(&self) -> bool {
        self.inner.is_end_stream()
    }

    fn size_hint(&self) -> SizeHint {
        self.inner.size_hint()
    }
}

impl Drop for CaptureBody {
    fn drop(&mut self) {
        let error = (self.direction == Direction::Response && !self.complete())
            .then(|| "Client closed the connection before the response finished".to_string());
        self.finish(error);
    }
}
