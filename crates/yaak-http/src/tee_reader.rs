use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, ReadBuf};
use tokio::sync::mpsc;

/// A reader that forwards all read data to a channel while also returning it to the caller.
/// This allows capturing request body data as it's being sent.
/// Uses an unbounded channel to ensure all data is captured without blocking the request.
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
                    // Send to unbounded channel - this never blocks
                    // Ignore error if receiver is closed
                    let _ = self.tx.send(data);
                }
                Poll::Ready(Ok(()))
            }
            Poll::Ready(Err(e)) => Poll::Ready(Err(e)),
            Poll::Pending => Poll::Pending,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use tokio::io::AsyncReadExt;

    #[tokio::test]
    async fn test_tee_reader_captures_all_data() {
        let data = b"Hello, World!";
        let cursor = Cursor::new(data.to_vec());
        let (tx, mut rx) = mpsc::unbounded_channel();

        let mut tee = TeeReader::new(cursor, tx);
        let mut output = Vec::new();
        tee.read_to_end(&mut output).await.unwrap();

        // Verify the reader returns the correct data
        assert_eq!(output, data);

        // Verify the channel received the data
        let mut captured = Vec::new();
        while let Ok(chunk) = rx.try_recv() {
            captured.extend(chunk);
        }
        assert_eq!(captured, data);
    }

    #[tokio::test]
    async fn test_tee_reader_with_chunked_reads() {
        let data = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        let cursor = Cursor::new(data.to_vec());
        let (tx, mut rx) = mpsc::unbounded_channel();

        let mut tee = TeeReader::new(cursor, tx);

        // Read in small chunks
        let mut buf = [0u8; 5];
        let mut output = Vec::new();
        loop {
            let n = tee.read(&mut buf).await.unwrap();
            if n == 0 {
                break;
            }
            output.extend_from_slice(&buf[..n]);
        }

        // Verify the reader returns the correct data
        assert_eq!(output, data);

        // Verify the channel received all chunks
        let mut captured = Vec::new();
        while let Ok(chunk) = rx.try_recv() {
            captured.extend(chunk);
        }
        assert_eq!(captured, data);
    }

    #[tokio::test]
    async fn test_tee_reader_empty_data() {
        let data: Vec<u8> = vec![];
        let cursor = Cursor::new(data.clone());
        let (tx, mut rx) = mpsc::unbounded_channel();

        let mut tee = TeeReader::new(cursor, tx);
        let mut output = Vec::new();
        tee.read_to_end(&mut output).await.unwrap();

        // Verify empty output
        assert!(output.is_empty());

        // Verify no data was sent to channel
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn test_tee_reader_works_when_receiver_dropped() {
        let data = b"Hello, World!";
        let cursor = Cursor::new(data.to_vec());
        let (tx, rx) = mpsc::unbounded_channel();

        // Drop the receiver before reading
        drop(rx);

        let mut tee = TeeReader::new(cursor, tx);
        let mut output = Vec::new();

        // Should still work even though receiver is dropped
        tee.read_to_end(&mut output).await.unwrap();
        assert_eq!(output, data);
    }

    #[tokio::test]
    async fn test_tee_reader_large_data() {
        // Test with 1MB of data
        let data: Vec<u8> = (0..1024 * 1024).map(|i| (i % 256) as u8).collect();
        let cursor = Cursor::new(data.clone());
        let (tx, mut rx) = mpsc::unbounded_channel();

        let mut tee = TeeReader::new(cursor, tx);
        let mut output = Vec::new();
        tee.read_to_end(&mut output).await.unwrap();

        // Verify the reader returns the correct data
        assert_eq!(output, data);

        // Verify the channel received all data
        let mut captured = Vec::new();
        while let Ok(chunk) = rx.try_recv() {
            captured.extend(chunk);
        }
        assert_eq!(captured, data);
    }
}
