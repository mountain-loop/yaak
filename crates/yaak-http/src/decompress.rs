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
        // Always room to write, so a call that makes no progress has run out of input.
        out.reserve(64 * 1024);
        let (read, written) = (inflater.total_in(), inflater.total_out());
        let rest = &data[usize::try_from(read).unwrap_or(data.len()).min(data.len())..];
        // Not `Finish`, which fails for good when the output outgrows its buffer.
        let status = inflater
            .decompress_vec(rest, &mut out, flate2::FlushDecompress::None)
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

/// Decodes `deflate`, zlib-wrapped or raw, as its first five bytes say. When they could be
/// either, it decodes both ways at once until one fails, and goes on with the other.
struct StreamingDeflateDecoder<R> {
    state: DeflateState<R>,
}

enum DeflateState<R> {
    Sniffing(Replay<R>),
    Zlib(AsyncZlibDecoder<BufReader<Replay<R>>>),
    Raw(AsyncDeflateDecoder<BufReader<Replay<R>>>),
    Either(EitherInflate<BufReader<Replay<R>>>),
    /// Only while switching from sniffing to one of the others
    Switching,
}

impl<R> StreamingDeflateDecoder<R> {
    fn new(reader: R) -> Self {
        let source = Replay { inner: reader, header: Vec::new(), pos: 0, sniffing: true };
        Self { state: DeflateState::Sniffing(source) }
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
            match &mut this.state {
                DeflateState::Sniffing(source) => {
                    // Read until the header is in hand, or the input ends short of it.
                    while source.header.len() < 5 {
                        let mut header = [0u8; 5];
                        let mut header = ReadBuf::new(&mut header[source.header.len()..]);
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
                    source.sniffing = false;
                    let variant = deflate_variant(&source.header);
                    let reader = BufReader::new(source);
                    this.state = match variant {
                        DeflateVariant::Zlib => DeflateState::Zlib(AsyncZlibDecoder::new(reader)),
                        DeflateVariant::Raw => DeflateState::Raw(AsyncDeflateDecoder::new(reader)),
                        DeflateVariant::Either => DeflateState::Either(EitherInflate::new(reader)),
                    };
                }
                DeflateState::Zlib(d) => return Pin::new(d).poll_read(cx, buf),
                DeflateState::Raw(d) => return Pin::new(d).poll_read(cx, buf),
                DeflateState::Either(d) => return Pin::new(d).poll_read(cx, buf),
                DeflateState::Switching => {
                    return Poll::Ready(Err(std::io::Error::other("deflate decoder is broken")));
                }
            }
        }
    }
}

/// Reads `inner`, keeping what it read while sniffing, then reads that again before the rest.
struct Replay<R> {
    inner: R,
    header: Vec<u8>,
    /// Where reading resumes in `header` once sniffing is over
    pos: usize,
    sniffing: bool,
}

impl<R: AsyncRead + Unpin> AsyncRead for Replay<R> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        if this.sniffing {
            let before = buf.filled().len();
            ready!(Pin::new(&mut this.inner).poll_read(cx, buf))?;
            this.header.extend_from_slice(&buf.filled()[before..]);
            return Poll::Ready(Ok(()));
        }
        if this.pos < this.header.len() {
            let n = buf.remaining().min(this.header.len() - this.pos);
            buf.put_slice(&this.header[this.pos..this.pos + n]);
            this.pos += n;
            return Poll::Ready(Ok(()));
        }
        Pin::new(&mut this.inner).poll_read(cx, buf)
    }
}

/// Input fed to the readings of an ambiguous deflate body at a time, which deflate grows to at
/// most about a megabyte
const DEFLATE_FEED: usize = 1024;

/// Output held while both readings of an ambiguous deflate body are still valid, past which it is
/// taken to be zlib, as its header says. A wrong reading fails within a few bytes in practice.
const DEFLATE_HELD_LIMIT: usize = 1024 * 1024;

/// Both readings of a deflate body that could be zlib or raw, fed the same input. Their output
/// is held back while both are still valid, and the one left streams on: a wrong reading fails
/// within a few bytes in practice, so little is held. If both end, zlib's checksum verified it.
struct EitherInflate<B> {
    input: B,
    /// Zlib, then raw
    readings: [Option<Inflate>; 2],
    /// Why the last reading to fail failed
    error: Option<std::io::Error>,
}

struct Inflate {
    inflater: flate2::Decompress,
    out: Vec<u8>,
    /// Where reading resumes in `out`
    pos: usize,
    ended: bool,
}

impl<B> EitherInflate<B> {
    fn new(input: B) -> Self {
        let reading = |zlib| Inflate {
            inflater: flate2::Decompress::new(zlib),
            out: Vec::new(),
            pos: 0,
            ended: false,
        };
        Self { input, readings: [Some(reading(true)), Some(reading(false))], error: None }
    }
}

impl Inflate {
    /// Decodes all of `input` onto `out`, or up to the end of the stream
    fn feed(&mut self, input: &[u8]) -> std::io::Result<()> {
        let mut consumed = 0;
        while !self.ended {
            if self.out.capacity() - self.out.len() < 32 * 1024 {
                self.out.reserve(64 * 1024);
            }
            let (read, written) = (self.inflater.total_in(), self.inflater.total_out());
            let status = self
                .inflater
                .decompress_vec(&input[consumed..], &mut self.out, flate2::FlushDecompress::None)
                .map_err(std::io::Error::other)?;
            let progress = (self.inflater.total_in() - read, self.inflater.total_out() - written);
            consumed += usize::try_from(progress.0).unwrap_or(usize::MAX).min(input.len());
            if status == flate2::Status::StreamEnd {
                self.ended = true;
            } else if consumed == input.len() && self.out.len() < self.out.capacity() {
                // All of it in, and all that it decodes to out
                break;
            } else if progress == (0, 0) {
                return Err(std::io::Error::other("deflate decoding stalled"));
            }
        }
        Ok(())
    }
}

impl<B: AsyncBufRead + Unpin> AsyncRead for EitherInflate<B> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        loop {
            let [zlib, raw] = &mut this.readings;
            match (zlib.as_mut(), raw.as_mut()) {
                (None, None) => {
                    let error = this.error.take();
                    return Poll::Ready(Err(
                        error.unwrap_or_else(|| std::io::Error::other("deflate decoding failed"))
                    ));
                }
                // Both ended: zlib's checksum verified it.
                (Some(z), Some(r)) if z.ended && r.ended => *raw = None,
                (Some(only), None) | (None, Some(only)) => {
                    if only.pos < only.out.len() {
                        let n = buf.remaining().min(only.out.len() - only.pos);
                        buf.put_slice(&only.out[only.pos..only.pos + n]);
                        only.pos += n;
                        if only.pos == only.out.len() {
                            only.out.clear();
                            only.pos = 0;
                        }
                        return Poll::Ready(Ok(()));
                    }
                    if only.ended {
                        return Poll::Ready(Ok(()));
                    }
                    ready!(this.feed(cx))?;
                }
                (Some(_), Some(_)) => ready!(this.feed(cx))?,
            }
        }
    }
}

impl<B: AsyncBufRead + Unpin> EitherInflate<B> {
    /// Feeds the next input to each reading still going, dropping those that fail on it. Pending
    /// until there is input; at its end, a reading that hasn't ended was cut short.
    fn feed(&mut self, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        let chunk = ready!(Pin::new(&mut self.input).poll_fill_buf(cx))?;
        // A little input at a time, since deflate can grow a thousandfold.
        let len = chunk.len().min(DEFLATE_FEED);
        let chunk = &chunk[..len];
        let [zlib, raw] = &mut self.readings;
        if let (Some(z), Some(r)) = (zlib.as_ref(), raw.as_ref()) {
            let (z_held, r_held) = (z.out.len() - z.pos, r.out.len() - r.pos);
            let cut_short = len == 0 && !z.ended && !r.ended;
            if cut_short {
                // Both were cut short: keep what decoded furthest, so a cut body shows its start.
                if r_held > z_held {
                    *zlib = None
                } else {
                    *raw = None
                }
                // The one left gives what it decoded, then fails on the end of input.
                return Poll::Ready(Ok(()));
            } else if z_held.max(r_held) > DEFLATE_HELD_LIMIT {
                // Holding no more for a raw body zlib still reads validly: it is taken to be zlib.
                *raw = None;
            }
        }
        for slot in &mut self.readings {
            let Some(reading) = slot.as_mut().filter(|r| !r.ended) else {
                continue;
            };
            let result = if len == 0 {
                Err(std::io::ErrorKind::UnexpectedEof.into())
            } else {
                reading.feed(chunk)
            };
            if let Err(e) = result {
                *slot = None;
                self.error = Some(e);
            }
        }
        Pin::new(&mut self.input).consume(len);
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
    /// 0xffe2 bytes, which `1d 00 e2 ff` also reads as the start of, and a final stored block of
    /// `extra` bytes.
    fn zlib_like_raw_deflate(extra: u16) -> (Vec<u8>, Vec<u8>) {
        let data: Vec<u8> = (0..0xffe2 + u32::from(extra)).map(|i| (i % 251) as u8).collect();
        let mut out = vec![0x08, 0x1d, 0x00, 0xe2, 0xff, 0x1d, 0x00];
        out.extend_from_slice(&data[..0xffe2]);
        out.push(0x01);
        out.extend_from_slice(&extra.to_le_bytes());
        out.extend_from_slice(&(!extra).to_le_bytes());
        out.extend_from_slice(&data[0xffe2..]);
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

    /// What a body decodes to before it fails, and why it failed
    async fn stream_decode_until_error(data: Vec<u8>) -> (Vec<u8>, Option<std::io::Error>) {
        use tokio::io::AsyncReadExt;
        let mut out = Vec::new();
        let mut decoder =
            streaming_decoder(BufReader::new(std::io::Cursor::new(data)), ContentEncoding::Deflate);
        let mut buf = [0u8; 4096];
        loop {
            match decoder.read(&mut buf).await {
                Ok(0) => return (out, None),
                Ok(n) => out.extend_from_slice(&buf[..n]),
                Err(e) => return (out, Some(e)),
            }
        }
    }

    #[tokio::test]
    async fn streaming_deflate_keeps_what_decoded_of_a_cut_ambiguous_body() {
        // Bytes both readings still accept when the input ends: zlib in a stored block too
        let text = *b"\x1d\0xxxxxxxxxxxxxxxxxxxxxxxxxxx";
        let mut cut = raw_deflate_like_zlib(&text);
        // Without its final block, as a body cut at the capture limit is
        cut.truncate(cut.len() - 5);
        let (decoded, error) = stream_decode_until_error(cut).await;
        assert_eq!(decoded, text);
        assert_eq!(error.map(|e| e.kind()), Some(std::io::ErrorKind::UnexpectedEof));
    }

    /// Zlib of `megabytes` of zeros whose raw reading is a stored block of 29 bytes and an empty
    /// final one, both inside zlib's first stored block: raw ends at once, zlib goes on.
    fn zlib_whose_raw_reading_ends_early(megabytes: usize) -> (Vec<u8>, Vec<u8>) {
        let mut stored = vec![b'z'; 0xffe2];
        stored[27..32].copy_from_slice(&[0x01, 0x00, 0x00, 0xff, 0xff]);
        let mut expected = stored.clone();
        expected.resize(stored.len() + megabytes * 1024 * 1024, 0);
        let mut data = vec![0x08, 0x1d, 0x00, 0xe2, 0xff, 0x1d, 0x00];
        data.extend_from_slice(&stored);
        data.extend_from_slice(&raw_deflate(&expected[stored.len()..]));
        let (mut a, mut b) = (1u32, 0u32);
        for byte in &expected {
            a = (a + u32::from(*byte)) % 65521;
            b = (b + a) % 65521;
        }
        data.extend_from_slice(&((b << 16) | a).to_be_bytes());
        assert_eq!(deflate_variant(&data), DeflateVariant::Either);
        (data, expected)
    }

    #[tokio::test]
    async fn streaming_deflate_holds_little_while_both_readings_go() {
        use tokio::io::AsyncReadExt;
        let (data, expected) = zlib_whose_raw_reading_ends_early(8);
        let mut decoder =
            StreamingDeflateDecoder::new(BufReader::new(std::io::Cursor::new(data.clone())));
        let mut first = [0u8; 1024];
        decoder.read_exact(&mut first).await.unwrap();
        assert_eq!(first[..], expected[..1024]);
        let DeflateState::Either(either) = &decoder.state else {
            panic!("not read both ways")
        };
        // The limit, what one feed of input adds past it (deflate grows at most about 1,032
        // times), and the raw reading's 64 KB: far short of the 8 MB body.
        let held: usize = either.readings.iter().flatten().map(|r| r.out.len() - r.pos).sum();
        let bound = 3 * 1024 * 1024;
        assert!(held <= bound, "held {held} bytes for a 1 KB read");

        let decoded = stream_decode(data, ContentEncoding::Deflate).await.unwrap();
        assert!(decoded == expected);
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
        for extra in [0, 10_000] {
            let (zlib_like_raw, data) = zlib_like_raw_deflate(extra);
            let result = decompress(zlib_like_raw, ContentEncoding::Deflate).unwrap();
            assert!(result.data == data, "{extra} extra bytes");
        }
        let (data, expected) = large_raw_like_zlib();
        assert!(decompress(data, ContentEncoding::Deflate).unwrap().data == expected);
    }

    /// Ambiguous raw deflate of more than 64 KB: a stored block that reads as zlib's header and
    /// the start of a stored block of 0xffe2 bytes, then incompressible data, which zlib reads
    /// as a block header 7 + 0xffe2 bytes in and fails on.
    fn large_raw_like_zlib() -> (Vec<u8>, Vec<u8>) {
        let mut expected = b"\x1d\0xxxxxxxxxxxxxxxxxxxxxxxxxxx".to_vec();
        let mut seed = 1u32;
        expected.extend((0..70_000).map(|_| {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            (seed >> 16) as u8
        }));
        let mut data = vec![0x08, 0x1d, 0x00, 0xe2, 0xff];
        data.extend_from_slice(&expected[..29]);
        data.extend_from_slice(&raw_deflate(&expected[29..]));
        assert!(data.len() > 64 * 1024);
        (data, expected)
    }

    /// Greptile's case on #812: raw deflate that zlib reads validly past 64 KB. After the first
    /// stored block, a final stored block of 65,535 bytes, in which zlib finds a valid stored
    /// block header at 65,513 (`00 28 00 d7 ff`) and an invalid block type only at 65,558.
    fn raw_valid_as_zlib_past_64k() -> (Vec<u8>, Vec<u8>) {
        let mut block: Vec<u8> = (0..65_535u32).map(|i| b'a' + (i % 26) as u8).collect();
        let first = 5 + 29 + 5;
        block[65_513 - first..65_518 - first].copy_from_slice(&[0x00, 0x28, 0x00, 0xd7, 0xff]);
        block[65_558 - first] = 0x07;
        let mut expected = b"\x1d\0xxxxxxxxxxxxxxxxxxxxxxxxxxx".to_vec();
        let mut data = raw_deflate_like_zlib(&expected.clone().try_into().unwrap());
        // Make the first block not the last, and follow it with the large final one.
        data.truncate(data.len() - 5);
        data.extend_from_slice(&[0x01, 0xff, 0xff, 0x00, 0x00]);
        data.extend_from_slice(&block);
        expected.extend_from_slice(&block);
        (data, expected)
    }

    #[test]
    fn test_decompress_deflate_raw_valid_as_zlib_past_64k() {
        let (data, expected) = raw_valid_as_zlib_past_64k();
        // Raw alone decodes it; zlib alone gets past 64 KB before failing.
        let mut raw = Vec::new();
        DeflateDecoder::new(data.as_slice()).read_to_end(&mut raw).unwrap();
        assert!(raw == expected);
        let mut zlib = flate2::Decompress::new(true);
        let mut out = Vec::with_capacity(200 * 1024);
        let failed = zlib.decompress_vec(&data, &mut out, flate2::FlushDecompress::None);
        assert!(failed.is_err() && zlib.total_in() > 65_536, "zlib read {}", zlib.total_in());
        assert!(decompress(data, ContentEncoding::Deflate).unwrap().data == expected);
    }

    #[tokio::test]
    async fn streaming_deflate_decodes_raw_valid_as_zlib_past_64k() {
        use tokio::io::AsyncReadExt;
        let (data, expected) = raw_valid_as_zlib_past_64k();
        for capacity in [1, 8 * 1024, 256 * 1024] {
            let mut out = Vec::new();
            let reader = BufReader::with_capacity(capacity, std::io::Cursor::new(data.clone()));
            streaming_decoder(reader, ContentEncoding::Deflate)
                .read_to_end(&mut out)
                .await
                .unwrap();
            assert!(out == expected, "read {capacity} bytes at a time");
        }
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
        for extra in [0, 10_000] {
            let (data, expected) = zlib_like_raw_deflate(extra);
            let decoded = stream_decode(data, ContentEncoding::Deflate).await.unwrap();
            assert!(decoded == expected, "{extra} extra bytes");
        }
    }

    /// However the reader reads ahead, the wrong reading is dropped and the right one kept.
    #[tokio::test]
    async fn streaming_deflate_retries_large_raw_whatever_the_chunking() {
        use tokio::io::AsyncReadExt;
        let (data, expected) = large_raw_like_zlib();
        for capacity in [1, 8 * 1024, 256 * 1024] {
            let mut out = Vec::new();
            let reader = BufReader::with_capacity(capacity, std::io::Cursor::new(data.clone()));
            streaming_decoder(reader, ContentEncoding::Deflate)
                .read_to_end(&mut out)
                .await
                .unwrap();
            assert!(out == expected, "read {capacity} bytes at a time");
        }
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
