use crate::error::{Error, Result};
use async_compression::tokio::bufread::{
    BrotliDecoder, DeflateDecoder as AsyncDeflateDecoder, GzipDecoder,
    ZstdDecoder as AsyncZstdDecoder,
};
use flate2::read::{DeflateDecoder, GzDecoder};
use std::io::Read;
use tokio::io::{AsyncBufRead, AsyncRead};

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

fn decompress_deflate(data: &[u8]) -> Result<Vec<u8>> {
    let mut decoder = DeflateDecoder::new(data);
    let mut decompressed = Vec::new();
    decoder
        .read_to_end(&mut decompressed)
        .map_err(|e| Error::DecompressionError(format!("deflate decompression failed: {}", e)))?;
    Ok(decompressed)
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
        ContentEncoding::Deflate => Box::new(AsyncDeflateDecoder::new(reader)),
        ContentEncoding::Brotli => Box::new(BrotliDecoder::new(reader)),
        ContentEncoding::Zstd => Box::new(AsyncZstdDecoder::new(reader)),
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
