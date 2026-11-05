use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::task::{Context, Poll};
use std::time::Instant;

use bytes::Bytes;
use hyper::body::{Body, Frame, Incoming, SizeHint};

use crate::grpc::{self, GrpcParser};
use crate::messages::StreamMessage;
use crate::sse::SseParser;
use crate::{Engine, ProxyEvent};

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Direction {
    Request,
    Response,
}

/// Reads a streaming body's messages as the body passes.
pub(crate) enum BodyParser {
    Sse(Box<SseParser>),
    Grpc(GrpcParser),
}

impl BodyParser {
    fn feed(&mut self, data: &[u8]) -> Vec<StreamMessage> {
        match self {
            Self::Sse(p) => p.feed(data),
            Self::Grpc(p) => p.feed(data),
        }
    }

    fn trailers(&mut self, trailers: &hyper::HeaderMap) -> Option<StreamMessage> {
        match self {
            Self::Sse(_) => None,
            Self::Grpc(_) => grpc::trailers_from_headers(trailers),
        }
    }

    /// The body ended: messages held back for what might have followed.
    fn finish(&mut self) -> Vec<StreamMessage> {
        match self {
            Self::Sse(p) => p.finish(),
            Self::Grpc(_) => Vec::new(),
        }
    }
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
    /// Set when reading the body fails.
    failed: Option<Arc<AtomicBool>>,
    parser: Option<BodyParser>,
}

impl CaptureBody {
    pub(crate) fn new(
        inner: Incoming,
        direction: Direction,
        id: u64,
        start: Instant,
        engine: Arc<Engine>,
    ) -> Self {
        Self {
            inner,
            direction,
            id,
            start,
            engine,
            captured: 0,
            size: 0,
            finished: false,
            failed: None,
            parser: None,
        }
    }

    /// Records the messages `parser` reads from the body, all of it, past the capture limit too.
    pub(crate) fn with_parser(mut self, parser: Option<BodyParser>) -> Self {
        self.parser = parser;
        self
    }

    fn emit_messages(&self, messages: impl IntoIterator<Item = StreamMessage>) {
        for message in messages {
            self.engine.emit(ProxyEvent::Message { id: self.id, message });
        }
    }

    /// Sets `failed` if reading the body fails, as a client's upload does when it cancels.
    pub(crate) fn flag_failure(mut self, failed: Arc<AtomicBool>) -> Self {
        self.failed = Some(failed);
        self
    }

    /// Every byte the body declared has arrived. An HTTP/2 stream's end can come in a frame after
    /// its last byte, and hyper stops polling a Content-Length body once it has written that
    /// many bytes, so the stream's end alone would call a complete body cut short.
    fn complete(&self) -> bool {
        self.inner.is_end_stream() || self.inner.size_hint().exact() == Some(0)
    }

    fn finish(&mut self, error: Option<String>, cancelled: bool) {
        if self.finished {
            return;
        }
        self.finished = true;
        // Before the body's end, so they land while the flow is still open.
        if let Some(parser) = self.parser.as_mut() {
            let messages = parser.finish();
            self.emit_messages(messages);
        }
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
                cancelled,
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
                    if let Some(parser) = self.parser.as_mut() {
                        let messages = parser.feed(frame_data);
                        self.emit_messages(messages);
                    }
                } else if let Some(trailers) = frame.trailers_ref()
                    && let Some(parser) = self.parser.as_mut()
                {
                    let message = parser.trailers(trailers);
                    self.emit_messages(message);
                }
                // A gRPC call's status comes in trailers after its last byte, so its body is
                // done only at the stream's end.
                let grpc = matches!(self.parser, Some(BodyParser::Grpc(_)));
                if if grpc { self.inner.is_end_stream() } else { self.complete() } {
                    self.finish(None, false);
                }
            }
            Poll::Ready(Some(Err(e))) => {
                if let Some(failed) = &self.failed {
                    failed.store(true, Ordering::Relaxed);
                }
                let error = e.to_string();
                self.finish(Some(error), false);
            }
            Poll::Ready(None) => self.finish(None, false),
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

/// A response body dropped before its end was abandoned by the client, which reset its stream or
/// closed the connection. Dropping the upstream body with it cancels the request there too.
impl Drop for CaptureBody {
    fn drop(&mut self) {
        let cancelled = self.direction == Direction::Response && !self.complete();
        self.finish(None, cancelled);
    }
}
