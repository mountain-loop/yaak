//! A response body's `Content-Encoding` undone as it streams, for parsers that read messages
//! from the body. Output comes in pieces of at most [`PIECE`] bytes, so a highly compressed
//! body never expands in memory all at once.

use flate2::{Decompress, FlushDecompress, Status};

/// The most decompressed bytes handed on at once.
const PIECE: usize = 16 * 1024;

const GZIP_FHCRC: u8 = 0x02;
const GZIP_FEXTRA: u8 = 0x04;
const GZIP_FNAME: u8 = 0x08;
const GZIP_FCOMMENT: u8 = 0x10;

/// How a body is encoded, from its `Content-Encoding`.
pub(crate) enum Decoding {
    Identity,
    Decoder(Box<ContentDecoder>),
    /// One this cannot undo.
    Unsupported,
}

impl Decoding {
    pub(crate) fn new(content_encoding: Option<&str>) -> Self {
        match content_encoding.map(|e| e.trim().to_ascii_lowercase()).as_deref() {
            None | Some("") | Some("identity") => Self::Identity,
            Some("gzip") | Some("x-gzip") => Self::Decoder(Box::new(ContentDecoder::gzip())),
            Some("deflate") => Self::Decoder(Box::new(ContentDecoder::deflate())),
            Some(_) => Self::Unsupported,
        }
    }
}

pub(crate) struct ContentDecoder {
    decompress: Decompress,
    /// A gzip header still to be read, as much of it as has come; None once it is read, or for
    /// deflate, which zlib's own header covers.
    gzip_header: Option<Vec<u8>>,
    /// The compressed stream ended; anything after it (a gzip trailer) is not read.
    ended: bool,
    /// Deflate's `zlib` framing, which some servers leave out.
    zlib: bool,
    /// No output yet, so a deflate body without zlib framing can still be tried raw.
    started: bool,
    /// The input until the first output, while it may yet turn out not to be zlib-framed.
    unframed: Vec<u8>,
}

impl ContentDecoder {
    fn gzip() -> Self {
        Self {
            decompress: Decompress::new(false),
            gzip_header: Some(Vec::new()),
            ended: false,
            zlib: false,
            started: false,
            unframed: Vec::new(),
        }
    }

    fn deflate() -> Self {
        Self {
            decompress: Decompress::new(true),
            gzip_header: None,
            ended: false,
            zlib: true,
            started: false,
            unframed: Vec::new(),
        }
    }

    /// Decompresses `input`, handing the output on to `out` a piece at a time.
    pub(crate) fn feed(
        &mut self,
        mut input: &[u8],
        out: &mut impl FnMut(&[u8]),
    ) -> Result<(), String> {
        if let Some(header) = self.gzip_header.as_mut() {
            let before = header.len();
            header.extend_from_slice(input);
            match gzip_header_len(header)? {
                None => return Ok(()),
                Some(len) => {
                    input = &input[len - before..];
                    self.gzip_header = None;
                }
            }
        }
        if self.zlib && !self.started {
            self.unframed.extend_from_slice(input);
        }
        let mut buf = [0u8; PIECE];
        while !input.is_empty() && !self.ended {
            let (read_before, written_before) =
                (self.decompress.total_in(), self.decompress.total_out());
            let status = match self.decompress.decompress(input, &mut buf, FlushDecompress::None) {
                Ok(status) => status,
                // "deflate" is meant to be zlib-framed, but some servers send it raw: read again
                // from the start as raw.
                Err(_) if self.zlib && !self.started => {
                    self.decompress = Decompress::new(false);
                    self.zlib = false;
                    let replay = std::mem::take(&mut self.unframed);
                    return self.feed(&replay, out);
                }
                Err(e) => return Err(e.to_string()),
            };
            let read = (self.decompress.total_in() - read_before) as usize;
            let written = (self.decompress.total_out() - written_before) as usize;
            input = &input[read..];
            if written > 0 {
                self.started = true;
                self.unframed = Vec::new();
                out(&buf[..written]);
            }
            if status == Status::StreamEnd {
                self.ended = true;
            } else if read == 0 && written == 0 {
                break;
            }
        }
        Ok(())
    }
}

/// The length of the gzip header `bytes` starts with (RFC 1952 2.3), None while more of it is
/// still to come.
fn gzip_header_len(bytes: &[u8]) -> Result<Option<usize>, String> {
    if bytes.len() < 10 {
        return Ok(None);
    }
    if bytes[..3] != [0x1f, 0x8b, 0x08] {
        return Err("Not a gzip stream".into());
    }
    let flags = bytes[3];
    let mut len = 10;
    if flags & GZIP_FEXTRA != 0 {
        let Some(extra) = bytes.get(len..len + 2) else {
            return Ok(None);
        };
        len += 2 + u16::from_le_bytes([extra[0], extra[1]]) as usize;
    }
    for flag in [GZIP_FNAME, GZIP_FCOMMENT] {
        if flags & flag != 0 {
            match bytes.get(len..).and_then(|rest| rest.iter().position(|&b| b == 0)) {
                Some(end) => len += end + 1,
                None => return Ok(None),
            }
        }
    }
    if flags & GZIP_FHCRC != 0 {
        len += 2;
    }
    Ok((bytes.len() >= len).then_some(len))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn decode_bytewise(encoding: &str, compressed: &[u8]) -> (Vec<u8>, usize) {
        let Decoding::Decoder(mut decoder) = Decoding::new(Some(encoding)) else {
            panic!("no decoder for {encoding}");
        };
        let (mut out, mut largest) = (Vec::new(), 0);
        for byte in compressed {
            decoder
                .feed(&[*byte], &mut |piece| {
                    largest = largest.max(piece.len());
                    out.extend_from_slice(piece);
                })
                .unwrap();
        }
        (out, largest)
    }

    #[test]
    fn gzip_with_a_file_name_split_into_single_bytes() {
        let text = b"data: hello\n\n".repeat(50);
        let mut gz = flate2::GzBuilder::new()
            .filename("events.txt")
            .write(Vec::new(), flate2::Compression::default());
        gz.write_all(&text).unwrap();
        let (out, _) = decode_bytewise("gzip", &gz.finish().unwrap());
        assert_eq!(out, text);
    }

    #[test]
    fn deflate_framed_or_raw() {
        let text = b"some text to squeeze".repeat(20);
        let mut zlib = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        zlib.write_all(&text).unwrap();
        assert_eq!(decode_bytewise("deflate", &zlib.finish().unwrap()).0, text);
        let mut raw =
            flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
        raw.write_all(&text).unwrap();
        assert_eq!(decode_bytewise("deflate", &raw.finish().unwrap()).0, text);
    }

    #[test]
    fn a_highly_compressed_body_comes_out_in_pieces() {
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
        gz.write_all(&vec![b'a'; 4 << 20]).unwrap();
        let compressed = gz.finish().unwrap();
        let Decoding::Decoder(mut decoder) = Decoding::new(Some("gzip")) else {
            panic!()
        };
        let (mut total, mut largest) = (0, 0);
        decoder
            .feed(&compressed, &mut |piece| {
                total += piece.len();
                largest = largest.max(piece.len());
            })
            .unwrap();
        assert_eq!(total, 4 << 20);
        assert!(largest <= PIECE, "{largest}");
    }
}
