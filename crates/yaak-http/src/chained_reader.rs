use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, ReadBuf};

/// A stream that chains multiple AsyncRead sources together
pub(crate) struct ChainedReader {
    readers: Vec<ReaderType>,
    current_index: usize,
    current_reader: Option<Box<dyn AsyncRead + Send + Unpin + 'static>>,
}

#[derive(Clone)]
pub(crate) enum ReaderType {
    Bytes(Vec<u8>),
    FilePath(String),
}

impl ChainedReader {
    pub(crate) fn new(readers: Vec<ReaderType>) -> Self {
        Self { readers, current_index: 0, current_reader: None }
    }
}

impl AsyncRead for ChainedReader {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        loop {
            // Try to read from current reader if we have one
            if let Some(ref mut reader) = self.current_reader {
                let before_len = buf.filled().len();
                return match Pin::new(reader).poll_read(cx, buf) {
                    Poll::Ready(Ok(())) => {
                        if buf.filled().len() == before_len && buf.remaining() > 0 {
                            // Current reader is exhausted, move to next
                            self.current_reader = None;
                            continue;
                        }
                        Poll::Ready(Ok(()))
                    }
                    Poll::Ready(Err(e)) => Poll::Ready(Err(e)),
                    Poll::Pending => Poll::Pending,
                };
            }

            // We need to get the next reader
            if self.current_index >= self.readers.len() {
                // No more readers
                return Poll::Ready(Ok(()));
            }

            // Get the next reader
            let reader_type = self.readers[self.current_index].clone();
            self.current_index += 1;

            match reader_type {
                ReaderType::Bytes(bytes) => {
                    self.current_reader = Some(Box::new(io::Cursor::new(bytes)));
                }
                ReaderType::FilePath(path) => {
                    // We need to handle file opening synchronously in poll_read
                    // This is a limitation - we'll use blocking file open
                    match std::fs::File::open(&path) {
                        Ok(file) => {
                            // Convert std File to tokio File
                            let tokio_file = tokio::fs::File::from_std(file);
                            self.current_reader = Some(Box::new(tokio_file));
                        }
                        Err(e) => return Poll::Ready(Err(e)),
                    }
                }
            }
        }
    }
}
