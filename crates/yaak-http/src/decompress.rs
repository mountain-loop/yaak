use crate::error::{Error, Result};
use async_compression::tokio::bufread::{
    BrotliDecoder, DeflateDecoder as AsyncDeflateDecoder, GzipDecoder,
    ZlibDecoder as AsyncZlibDecoder, ZstdDecoder as AsyncZstdDecoder,
};
use flate2::read::{DeflateDecoder, GzDecoder, ZlibDecoder};
use std::io::Read;
use std::pin::Pin;
use std::task::{Context, Poll, ready};
use tokio::io::{AsyncBufRead, AsyncRead, BufReader, ReadBuf};

/// Supported compression encodings
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentEncoding {
    Gzip,
    Deflate,
    Brotli,
    Zstd,
    Identity,
}

impl ContentEncoding {
    /// Parse a Content-Encoding header value into an encoding type.
    /// Returns Identity for unknown or missing encodings.
    pub fn from_header(value: Option<&str>) -> Self {
        match value.map(|s| s.trim().to_lowercase()).as_deref() {
            Some("gzip") | Some("x-gzip") => ContentEncoding::Gzip,
            Some("deflate") => ContentEncoding::Deflate,
            Some("br") => ContentEncoding::Brotli,
            Some("zstd") => ContentEncoding::Zstd,
            _ => ContentEncoding::Identity,
        }
    }
}

/// Result of decompression, containing both the decompressed data and size info
#[derive(Debug)]
pub struct DecompressResult {
    pub data: Vec<u8>,
    pub compressed_size: u64,
    pub decompressed_size: u64,
}

/// Decompress data based on the Content-Encoding.
/// Returns the original data unchanged if encoding is Identity or unknown.
pub fn decompress(data: Vec<u8>, encoding: ContentEncoding) -> Result<DecompressResult> {
    let compressed_size = data.len() as u64;

    let decompressed = match encoding {
        ContentEncoding::Identity => data,
        ContentEncoding::Gzip => decompress_gzip(&data)?,
        ContentEncoding::Deflate => decompress_deflate(&data)?,
        ContentEncoding::Brotli => decompress_brotli(&data)?,
        ContentEncoding::Zstd => decompress_zstd(&data)?,
    };

    let decompressed_size = decompressed.len() as u64;

    Ok(DecompressResult { data: decompressed, compressed_size, decompressed_size })
}

fn decompress_gzip(data: &[u8]) -> Result<Vec<u8>> {
    let mut decoder = GzDecoder::new(data);
    let mut decompressed = Vec::new();
    decoder
        .read_to_end(&mut decompressed)
        .map_err(|e| Error::DecompressionError(format!("gzip decompression failed: {}", e)))?;
    Ok(decompressed)
}

/// `deflate` names zlib-wrapped data (RFC 1950), but plenty of senders send it raw (RFC 1951).
fn decompress_deflate(data: &[u8]) -> Result<Vec<u8>> {
    let read = |zlib: bool| {
        let mut decompressed = Vec::new();
        let result = if zlib {
            ZlibDecoder::new(data).read_to_end(&mut decompressed)
        } else {
            DeflateDecoder::new(data).read_to_end(&mut decompressed)
        };
        result.map(|_| decompressed)
    };
    let zlib = is_zlib_header(data);
    read(zlib)
        .or_else(|first| read(!zlib).map_err(|_| first))
        .map_err(|e| Error::DecompressionError(format!("deflate decompression failed: {}", e)))
}

/// The first two bytes are a zlib header: deflate with a window of at most 32 KB, and a check
/// value that makes them a multiple of 31. A raw deflate stream can pass by chance, so a decode
/// that fails this way is retried raw.
fn is_zlib_header(data: &[u8]) -> bool {
    match data {
        [cmf, flg, ..] => {
            cmf & 0x0f == 8 && cmf >> 4 <= 7 && (u16::from(*cmf) << 8 | u16::from(*flg)) % 31 == 0
        }
        _ => false,
    }
}

fn decompress_brotli(data: &[u8]) -> Result<Vec<u8>> {
    let mut decompressed = Vec::new();
    brotli::BrotliDecompress(&mut std::io::Cursor::new(data), &mut decompressed)
        .map_err(|e| Error::DecompressionError(format!("brotli decompression failed: {}", e)))?;
    Ok(decompressed)
}

fn decompress_zstd(data: &[u8]) -> Result<Vec<u8>> {
    zstd::stream::decode_all(std::io::Cursor::new(data))
        .map_err(|e| Error::DecompressionError(format!("zstd decompression failed: {}", e)))
}

/// Create a streaming decompressor that wraps an async reader.
/// Returns an AsyncRead that decompresses data on-the-fly.
pub fn streaming_decoder<R: AsyncBufRead + Unpin + Send + 'static>(
    reader: R,
    encoding: ContentEncoding,
) -> Box<dyn AsyncRead + Unpin + Send> {
    match encoding {
        ContentEncoding::Identity => Box::new(reader),
        ContentEncoding::Gzip => Box::new(GzipDecoder::new(reader)),
        ContentEncoding::Deflate => Box::new(StreamingDeflateDecoder::new(reader)),
        ContentEncoding::Brotli => Box::new(BrotliDecoder::new(reader)),
        ContentEncoding::Zstd => Box::new(AsyncZstdDecoder::new(reader)),
    }
}

/// Input kept to retry a deflate body as the other variant. A wrong guess fails in the first few
/// bytes, so this only bounds a body that fails late without decoding any output.
const DEFLATE_RETRY_WINDOW: usize = 64 * 1024;

/// Decodes `deflate`, zlib-wrapped or raw: the first two bytes pick one, and a decode that fails
/// before producing any output starts over as the other.
struct StreamingDeflateDecoder<R> {
    state: DeflateState<R>,
    produced: bool,
    retried: bool,
}

enum DeflateState<R> {
    Sniffing(Rewindable<R>),
    Zlib(AsyncZlibDecoder<BufReader<Rewindable<R>>>),
    Raw(AsyncDeflateDecoder<BufReader<Rewindable<R>>>),
    /// Only while switching between the others
    Switching,
}

impl<R> StreamingDeflateDecoder<R> {
    fn new(reader: R) -> Self {
        let source = Rewindable { inner: reader, kept: Vec::new(), pos: 0, keeping: true };
        Self { state: DeflateState::Sniffing(source), produced: false, retried: false }
    }
}

impl<R: AsyncRead + Unpin> StreamingDeflateDecoder<R> {
    /// Starts over from the first byte of input with the other variant
    fn retry(&mut self) {
        let (mut source, zlib) = match std::mem::replace(&mut self.state, DeflateState::Switching) {
            DeflateState::Zlib(d) => (d.into_inner().into_inner(), false),
            DeflateState::Raw(d) => (d.into_inner().into_inner(), true),
            other => {
                self.state = other;
                return;
            }
        };
        source.pos = 0;
        self.retried = true;
        self.state = decoder_for(source, zlib);
    }

    fn source(&mut self) -> Option<&mut Rewindable<R>> {
        match &mut self.state {
            DeflateState::Sniffing(s) => Some(s),
            DeflateState::Zlib(d) => Some(d.get_mut().get_mut()),
            DeflateState::Raw(d) => Some(d.get_mut().get_mut()),
            DeflateState::Switching => None,
        }
    }
}

fn decoder_for<R: AsyncRead + Unpin>(source: Rewindable<R>, zlib: bool) -> DeflateState<R> {
    let reader = BufReader::new(source);
    if zlib {
        DeflateState::Zlib(AsyncZlibDecoder::new(reader))
    } else {
        DeflateState::Raw(AsyncDeflateDecoder::new(reader))
    }
}

impl<R: AsyncRead + Unpin> AsyncRead for StreamingDeflateDecoder<R> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        loop {
            let before = buf.filled().len();
            let result = match &mut this.state {
                DeflateState::Sniffing(source) => {
                    // Read until the header is in hand, or the input ends short of it.
                    while source.kept.len() < 2 {
                        let mut header = [0u8; 2];
                        let mut header = ReadBuf::new(&mut header[source.kept.len()..]);
                        ready!(Pin::new(&mut *source).poll_read(cx, &mut header))?;
                        if header.filled().is_empty() {
                            break;
                        }
                    }
                    let DeflateState::Sniffing(mut source) =
                        std::mem::replace(&mut this.state, DeflateState::Switching)
                    else {
                        unreachable!()
                    };
                    source.pos = 0;
                    let zlib = is_zlib_header(&source.kept);
                    this.state = decoder_for(source, zlib);
                    continue;
                }
                DeflateState::Zlib(d) => ready!(Pin::new(d).poll_read(cx, buf)),
                DeflateState::Raw(d) => ready!(Pin::new(d).poll_read(cx, buf)),
                DeflateState::Switching => {
                    return Poll::Ready(Err(std::io::Error::other("deflate decoder is broken")));
                }
            };
            match result {
                Ok(()) => {
                    if !this.produced && buf.filled().len() > before {
                        this.produced = true;
                        if let Some(source) = this.source() {
                            source.forget();
                        }
                    }
                    return Poll::Ready(Ok(()));
                }
                Err(_)
                    if !this.produced
                        && !this.retried
                        && this.source().is_some_and(|s| s.keeping) =>
                {
                    buf.set_filled(before);
                    this.retry();
                }
                Err(e) => return Poll::Ready(Err(e)),
            }
        }
    }
}

/// Reads `inner`, keeping what it read from the start until `forget`, so that setting `pos` back
/// to 0 reads it all again.
struct Rewindable<R> {
    inner: R,
    kept: Vec<u8>,
    /// Where reading resumes in `kept`; past its end, reading goes to `inner`.
    pos: usize,
    /// `kept` holds every byte read so far.
    keeping: bool,
}

impl<R> Rewindable<R> {
    fn forget(&mut self) {
        self.keeping = false;
        if self.pos >= self.kept.len() {
            self.kept = Vec::new();
            self.pos = 0;
        }
    }
}

impl<R: AsyncRead + Unpin> AsyncRead for Rewindable<R> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        if this.pos < this.kept.len() {
            let n = buf.remaining().min(this.kept.len() - this.pos);
            buf.put_slice(&this.kept[this.pos..this.pos + n]);
            this.pos += n;
            if !this.keeping && this.pos == this.kept.len() {
                this.forget();
            }
            return Poll::Ready(Ok(()));
        }
        let before = buf.filled().len();
        ready!(Pin::new(&mut this.inner).poll_read(cx, buf))?;
        if this.keeping {
            let read = &buf.filled()[before..];
            if this.kept.len() + read.len() > DEFLATE_RETRY_WINDOW {
                this.forget();
            } else {
                this.kept.extend_from_slice(read);
                this.pos = this.kept.len();
            }
        }
        Poll::Ready(Ok(()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::Compression;
    use flate2::write::GzEncoder;
    use std::io::Write;

    #[test]
    fn test_content_encoding_from_header() {
        assert_eq!(ContentEncoding::from_header(Some("gzip")), ContentEncoding::Gzip);
        assert_eq!(ContentEncoding::from_header(Some("x-gzip")), ContentEncoding::Gzip);
        assert_eq!(ContentEncoding::from_header(Some("GZIP")), ContentEncoding::Gzip);
        assert_eq!(ContentEncoding::from_header(Some("deflate")), ContentEncoding::Deflate);
        assert_eq!(ContentEncoding::from_header(Some("br")), ContentEncoding::Brotli);
        assert_eq!(ContentEncoding::from_header(Some("zstd")), ContentEncoding::Zstd);
        assert_eq!(ContentEncoding::from_header(Some("identity")), ContentEncoding::Identity);
        assert_eq!(ContentEncoding::from_header(Some("unknown")), ContentEncoding::Identity);
        assert_eq!(ContentEncoding::from_header(None), ContentEncoding::Identity);
    }

    #[test]
    fn test_decompress_identity() {
        let data = b"hello world".to_vec();
        let result = decompress(data.clone(), ContentEncoding::Identity).unwrap();
        assert_eq!(result.data, data);
        assert_eq!(result.compressed_size, 11);
        assert_eq!(result.decompressed_size, 11);
    }

    #[test]
    fn test_decompress_gzip() {
        // Compress some data with gzip
        let original = b"hello world, this is a test of gzip compression";
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(original).unwrap();
        let compressed = encoder.finish().unwrap();

        let result = decompress(compressed.clone(), ContentEncoding::Gzip).unwrap();
        assert_eq!(result.data, original);
        assert_eq!(result.compressed_size, compressed.len() as u64);
        assert_eq!(result.decompressed_size, original.len() as u64);
    }

    #[test]
    fn test_decompress_deflate() {
        // Compress some data with deflate
        let original = b"hello world, this is a test of deflate compression";
        let mut encoder = flate2::write::DeflateEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(original).unwrap();
        let compressed = encoder.finish().unwrap();

        let result = decompress(compressed.clone(), ContentEncoding::Deflate).unwrap();
        assert_eq!(result.data, original);
        assert_eq!(result.compressed_size, compressed.len() as u64);
        assert_eq!(result.decompressed_size, original.len() as u64);
    }

    fn zlib(data: &[u8]) -> Vec<u8> {
        let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(data).unwrap();
        encoder.finish().unwrap()
    }

    fn raw_deflate(data: &[u8]) -> Vec<u8> {
        let mut encoder = flate2::write::DeflateEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(data).unwrap();
        encoder.finish().unwrap()
    }

    /// Raw deflate whose first two bytes also pass as a zlib header: a stored block of 29 bytes
    /// (`08 1d`, with `0x081d` a multiple of 31), then an empty final one.
    fn raw_deflate_like_zlib(data: &[u8; 29]) -> Vec<u8> {
        let mut out = vec![0x08, 0x1d, 0x00, 0xe2, 0xff];
        out.extend_from_slice(data);
        out.extend_from_slice(&[0x01, 0x00, 0x00, 0xff, 0xff]);
        assert!(is_zlib_header(&out));
        out
    }

    async fn stream_decode(data: Vec<u8>, encoding: ContentEncoding) -> std::io::Result<Vec<u8>> {
        use tokio::io::AsyncReadExt;
        let mut out = Vec::new();
        // One byte at a time, to read the header across polls as a slow connection would.
        let reader = BufReader::with_capacity(1, std::io::Cursor::new(data));
        streaming_decoder(reader, encoding).read_to_end(&mut out).await?;
        Ok(out)
    }

    const DEFLATE_TEXT: &[u8] = b"{\"service\":\"browser\",\"message\":\"hello deflate\"}";

    #[test]
    fn test_decompress_deflate_zlib_wrapped() {
        let result = decompress(zlib(DEFLATE_TEXT), ContentEncoding::Deflate).unwrap();
        assert_eq!(result.data, DEFLATE_TEXT);
        let like_zlib = raw_deflate_like_zlib(b"twenty-nine bytes of raw text");
        let result = decompress(like_zlib, ContentEncoding::Deflate).unwrap();
        assert_eq!(result.data, b"twenty-nine bytes of raw text");
    }

    #[tokio::test]
    async fn streaming_deflate_decodes_zlib_and_raw() {
        let zlib_wrapped = stream_decode(zlib(DEFLATE_TEXT), ContentEncoding::Deflate).await;
        assert_eq!(zlib_wrapped.unwrap(), DEFLATE_TEXT);
        let raw = stream_decode(raw_deflate(DEFLATE_TEXT), ContentEncoding::Deflate).await;
        assert_eq!(raw.unwrap(), DEFLATE_TEXT);
        let large: Vec<u8> = (0..200_000u32).flat_map(|i| (i % 251).to_le_bytes()).collect();
        let large_zlib = stream_decode(zlib(&large), ContentEncoding::Deflate).await;
        assert_eq!(large_zlib.unwrap(), large);
        let large_raw = stream_decode(raw_deflate(&large), ContentEncoding::Deflate).await;
        assert_eq!(large_raw.unwrap(), large);
    }

    #[tokio::test]
    async fn streaming_deflate_retries_raw_that_looks_like_zlib() {
        let data = raw_deflate_like_zlib(b"twenty-nine bytes of raw text");
        // A zlib decoder alone rejects it.
        assert!(ZlibDecoder::new(data.as_slice()).read_to_end(&mut Vec::new()).is_err());
        let decoded = stream_decode(data, ContentEncoding::Deflate).await.unwrap();
        assert_eq!(decoded, b"twenty-nine bytes of raw text");
    }

    #[tokio::test]
    async fn streaming_deflate_still_fails_on_garbage() {
        let garbage = b"\x78\x9c this is not deflate in any form".to_vec();
        assert!(stream_decode(garbage, ContentEncoding::Deflate).await.is_err());
        assert!(stream_decode(b"\xff".to_vec(), ContentEncoding::Deflate).await.is_err());
    }

    #[tokio::test]
    async fn streaming_gzip_is_unchanged() {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(DEFLATE_TEXT).unwrap();
        let gzip = encoder.finish().unwrap();
        assert_eq!(stream_decode(gzip, ContentEncoding::Gzip).await.unwrap(), DEFLATE_TEXT);
    }

    #[test]
    fn test_decompress_brotli() {
        // Compress some data with brotli
        let original = b"hello world, this is a test of brotli compression";
        let mut compressed = Vec::new();
        let mut writer = brotli::CompressorWriter::new(&mut compressed, 4096, 4, 22);
        writer.write_all(original).unwrap();
        drop(writer);

        let result = decompress(compressed.clone(), ContentEncoding::Brotli).unwrap();
        assert_eq!(result.data, original);
        assert_eq!(result.compressed_size, compressed.len() as u64);
        assert_eq!(result.decompressed_size, original.len() as u64);
    }

    #[test]
    fn test_decompress_zstd() {
        // Compress some data with zstd
        let original = b"hello world, this is a test of zstd compression";
        let compressed = zstd::stream::encode_all(std::io::Cursor::new(original), 3).unwrap();

        let result = decompress(compressed.clone(), ContentEncoding::Zstd).unwrap();
        assert_eq!(result.data, original);
        assert_eq!(result.compressed_size, compressed.len() as u64);
        assert_eq!(result.decompressed_size, original.len() as u64);
    }
}
