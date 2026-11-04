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
    match deflate_variant(data) {
        DeflateVariant::Zlib => read(true),
        DeflateVariant::Raw => read(false),
        // Zlib only when it ends whole, its checksum verified, or else raw.
        DeflateVariant::Either => inflate_zlib_whole(data).or_else(|_| read(false)),
    }
    .map_err(|e| Error::DecompressionError(format!("deflate decompression failed: {}", e)))
}

/// Zlib data decoded through to its end and checksum, failing on any less
fn inflate_zlib_whole(data: &[u8]) -> std::io::Result<Vec<u8>> {
    let mut inflater = flate2::Decompress::new(true);
    let mut out = Vec::new();
    loop {
        out.reserve(64 * 1024);
        let (read, written) = (inflater.total_in(), inflater.total_out());
        let rest = &data[usize::try_from(read).unwrap_or(data.len()).min(data.len())..];
        let status = inflater
            .decompress_vec(rest, &mut out, flate2::FlushDecompress::Finish)
            .map_err(std::io::Error::other)?;
        if status == flate2::Status::StreamEnd {
            return Ok(out);
        }
        if inflater.total_in() == read && inflater.total_out() == written {
            return Err(std::io::ErrorKind::UnexpectedEof.into());
        }
    }
}

/// Which `deflate` a body is, from its first five bytes
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeflateVariant {
    Zlib,
    Raw,
    /// A zlib header that is also the start of a raw stored block: only decoding tells.
    Either,
}

/// Zlib data opens with a header whose first byte names deflate with a window of at most 32 KB,
/// and whose two bytes are a multiple of 31. Raw deflate passes that only when it opens with a
/// stored block that isn't the last, whose length follows in the next two bytes and its
/// complement in the two after.
fn deflate_variant(data: &[u8]) -> DeflateVariant {
    let zlib = match data {
        [cmf, flg, ..] => {
            cmf & 0x0f == 8 && cmf >> 4 <= 7 && (u16::from(*cmf) << 8 | u16::from(*flg)) % 31 == 0
        }
        _ => false,
    };
    match data {
        _ if !zlib => DeflateVariant::Raw,
        [_, l0, l1, n0, n1, ..]
            if u16::from_le_bytes([*l0, *l1]) != !u16::from_le_bytes([*n0, *n1]) =>
        {
            DeflateVariant::Zlib
        }
        _ => DeflateVariant::Either,
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

/// Input kept, and output held back, to retry an ambiguous deflate body as raw. Past either, the
/// body is taken to be the zlib it has decoded as so far.
const DEFLATE_RETRY_WINDOW: usize = 64 * 1024;

/// Decodes `deflate`, zlib-wrapped or raw, as its first five bytes say. When they could be
/// either, it decodes as zlib holding the output back until the stream ends with its checksum
/// verified, and starts over as raw if it fails first.
struct StreamingDeflateDecoder<R> {
    state: DeflateState<R>,
    /// Output decoded while the variant is unsure: zlib, unless decoding fails.
    held: Option<Vec<u8>>,
    /// Output decoded and no longer held, still to be read
    pending: Vec<u8>,
    pending_pos: usize,
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
        Self {
            state: DeflateState::Sniffing(source),
            held: None,
            pending: Vec::new(),
            pending_pos: 0,
        }
    }
}

impl<R: AsyncRead + Unpin> StreamingDeflateDecoder<R> {
    /// Starts over from the first byte of input as raw deflate
    fn retry_raw(&mut self) {
        let DeflateState::Zlib(d) = std::mem::replace(&mut self.state, DeflateState::Switching)
        else {
            unreachable!("only zlib is retried")
        };
        let mut source = d.into_inner().into_inner();
        source.pos = 0;
        source.forget();
        self.held = None;
        self.state = decoder_for(source, false);
    }

    fn source(&mut self) -> Option<&mut Rewindable<R>> {
        match &mut self.state {
            DeflateState::Sniffing(s) => Some(s),
            DeflateState::Zlib(d) => Some(d.get_mut().get_mut()),
            DeflateState::Raw(d) => Some(d.get_mut().get_mut()),
            DeflateState::Switching => None,
        }
    }

    fn poll_decoder(
        &mut self,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        match &mut self.state {
            DeflateState::Zlib(d) => Pin::new(d).poll_read(cx, buf),
            DeflateState::Raw(d) => Pin::new(d).poll_read(cx, buf),
            _ => Poll::Ready(Err(std::io::Error::other("deflate decoder is broken"))),
        }
    }

    /// Stops holding output back, committing to zlib
    fn release(&mut self) {
        if let Some(held) = self.held.take() {
            self.pending = held;
            self.pending_pos = 0;
        }
        if let Some(source) = self.source() {
            source.forget();
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
            if this.pending_pos < this.pending.len() {
                let n = buf.remaining().min(this.pending.len() - this.pending_pos);
                buf.put_slice(&this.pending[this.pending_pos..this.pending_pos + n]);
                this.pending_pos += n;
                if this.pending_pos == this.pending.len() {
                    this.pending = Vec::new();
                    this.pending_pos = 0;
                }
                return Poll::Ready(Ok(()));
            }

            if let DeflateState::Sniffing(source) = &mut this.state {
                // Read until the header is in hand, or the input ends short of it.
                while source.kept.len() < 5 {
                    let mut header = [0u8; 5];
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
                let variant = deflate_variant(&source.kept);
                if variant == DeflateVariant::Either {
                    this.held = Some(Vec::new());
                } else {
                    source.forget();
                }
                this.state = decoder_for(source, variant != DeflateVariant::Raw);
                continue;
            }

            if this.held.is_none() {
                return this.poll_decoder(cx, buf);
            }

            let mut chunk = [0u8; 8192];
            let mut chunk = ReadBuf::new(&mut chunk);
            match ready!(this.poll_decoder(cx, &mut chunk)) {
                // The zlib stream ended whole, its checksum verified.
                Ok(()) if chunk.filled().is_empty() => this.release(),
                Ok(()) => {
                    let held = this.held.get_or_insert_with(Vec::new);
                    held.extend_from_slice(chunk.filled());
                    let held_len = held.len();
                    if held_len > DEFLATE_RETRY_WINDOW || this.source().is_some_and(|s| !s.keeping)
                    {
                        this.release();
                    }
                }
                Err(_) if this.source().is_some_and(|s| s.keeping) => this.retry_raw(),
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
        assert_eq!(deflate_variant(&out), DeflateVariant::Either);
        out
    }

    /// Zlib that opens as `raw_deflate_like_zlib` does: header `08 1d`, then a stored block of
    /// 0xffe2 bytes, which `1d 00 e2 ff` also reads as the start of, and an empty final one.
    fn zlib_like_raw_deflate() -> (Vec<u8>, Vec<u8>) {
        let data: Vec<u8> = (0..0xffe2u32).map(|i| (i % 251) as u8).collect();
        let mut out = vec![0x08, 0x1d, 0x00, 0xe2, 0xff, 0x1d, 0x00];
        out.extend_from_slice(&data);
        out.extend_from_slice(&[0x01, 0x00, 0x00, 0xff, 0xff]);
        let (mut a, mut b) = (1u32, 0u32);
        for byte in &data {
            a = (a + u32::from(*byte)) % 65521;
            b = (b + a) % 65521;
        }
        out.extend_from_slice(&((b << 16) | a).to_be_bytes());
        assert_eq!(deflate_variant(&out), DeflateVariant::Either);
        (out, data)
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
        let both = *b"\x1d\0xxxxxxxxxxxxxxxxxxxxxxxxxxx";
        let result = decompress(raw_deflate_like_zlib(&both), ContentEncoding::Deflate).unwrap();
        assert_eq!(result.data, both);
        let (zlib_like_raw, data) = zlib_like_raw_deflate();
        assert_eq!(decompress(zlib_like_raw, ContentEncoding::Deflate).unwrap().data, data);
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

        // Read as zlib, this one is a stored block that starts decoding, and only fails later.
        let both = *b"\x1d\0xxxxxxxxxxxxxxxxxxxxxxxxxxx";
        let data = raw_deflate_like_zlib(&both);
        let decoded = stream_decode(data, ContentEncoding::Deflate).await.unwrap();
        assert_eq!(decoded, both);
    }

    #[tokio::test]
    async fn streaming_deflate_decodes_zlib_that_looks_like_raw() {
        let (data, expected) = zlib_like_raw_deflate();
        assert_eq!(stream_decode(data, ContentEncoding::Deflate).await.unwrap(), expected);
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
