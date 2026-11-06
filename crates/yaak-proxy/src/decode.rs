//! A response body's `Content-Encoding` undone as it streams, for parsers that read messages
//! from the body. Output comes in pieces of at most [`PIECE`] bytes, so a highly compressed
//! body never expands in memory all at once.

use flate2::{Decompress, FlushDecompress, Status};

/// The most decompressed bytes handed on at once.
const PIECE: usize = 16 * 1024;
/// The longest gzip header waited for, its optional name, comment and extra field included.
const MAX_GZIP_HEADER: usize = 128 * 1024;

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
    /// `limit` bounds what decoding may hold on to: the input of a deflate body kept until it
    /// shows whether it is zlib-framed.
    pub(crate) fn new(content_encoding: Option<&str>, limit: usize) -> Self {
        match content_encoding.map(|e| e.trim().to_ascii_lowercase()).as_deref() {
            None | Some("") | Some("identity") => Self::Identity,
            Some("gzip") | Some("x-gzip") => Self::Decoder(Box::new(ContentDecoder::gzip(limit))),
            Some("deflate") => Self::Decoder(Box::new(ContentDecoder::deflate(limit))),
            Some(_) => Self::Unsupported,
        }
    }
}

pub(crate) struct ContentDecoder {
    decompress: Decompress,
    /// gzip, which comes in members, each with a header and a trailer.
    gzip: bool,
    /// A gzip member's header still to be read, as much of it as has come; None while a member
    /// is being inflated, and for deflate, which zlib's own header covers.
    gzip_header: Option<Vec<u8>>,
    /// How far the gzip header's name and comment have been searched for their ends.
    header_scanned: [usize; 2],
    /// Bytes of a gzip member's trailer (its CRC and length, not checked) still to skip.
    trailer_left: usize,
    /// gzip members read whole.
    members: usize,
    /// The compressed stream ended; anything after it is not read.
    ended: bool,
    /// Deflate's `zlib` framing, which some servers leave out.
    zlib: bool,
    /// No output yet, so a deflate body without zlib framing can still be tried raw.
    started: bool,
    /// The input until the first output, while it may yet turn out not to be zlib-framed.
    unframed: Vec<u8>,
    /// The most input kept in `unframed`: a body that has given no output by then is not
    /// decoded further.
    unframed_limit: usize,
}

impl ContentDecoder {
    fn gzip(limit: usize) -> Self {
        Self {
            decompress: Decompress::new(false),
            gzip: true,
            gzip_header: Some(Vec::new()),
            header_scanned: [0; 2],
            trailer_left: 0,
            members: 0,
            ended: false,
            zlib: false,
            started: false,
            unframed: Vec::new(),
            unframed_limit: limit,
        }
    }

    fn deflate(limit: usize) -> Self {
        Self {
            decompress: Decompress::new(true),
            gzip: false,
            gzip_header: None,
            header_scanned: [0; 2],
            trailer_left: 0,
            members: 0,
            ended: false,
            zlib: true,
            started: false,
            unframed: Vec::new(),
            unframed_limit: limit,
        }
    }

    /// Decompresses `input`, handing the output on to `out` a piece at a time.
    pub(crate) fn feed(&mut self, input: &[u8], out: &mut impl FnMut(&[u8])) -> Result<(), String> {
        self.feed_inner(input, out)?;
        // Kept only until the body gives output; empty deflate blocks can go on without end,
        // and what is kept for them cannot.
        if self.zlib && !self.started && self.unframed.len() > self.unframed_limit {
            self.unframed = Vec::new();
            return Err("No output from the deflate body within the capture limit".into());
        }
        Ok(())
    }

    fn feed_inner(&mut self, mut input: &[u8], out: &mut impl FnMut(&[u8])) -> Result<(), String> {
        if self.zlib && !self.started {
            self.unframed.extend_from_slice(input);
        }
        let mut buf = [0u8; PIECE];
        loop {
            if self.ended {
                return Ok(());
            }
            if self.trailer_left > 0 {
                let skip = self.trailer_left.min(input.len());
                input = &input[skip..];
                self.trailer_left -= skip;
                if self.trailer_left > 0 {
                    return Ok(());
                }
            }
            if let Some(header) = self.gzip_header.as_mut() {
                if input.is_empty() {
                    return Ok(());
                }
                let before = header.len();
                header.extend_from_slice(input);
                match gzip_header_len(header, &mut self.header_scanned) {
                    // A name or comment that never ends is no header to wait for.
                    Ok(None) if header.len() > MAX_GZIP_HEADER => {
                        return Err("The gzip header is too long".into());
                    }
                    Ok(None) => return Ok(()),
                    Ok(Some(len)) => {
                        input = &input[len - before..];
                        self.gzip_header = None;
                        self.header_scanned = [0; 2];
                    }
                    // What follows a whole member, padding say, is not another one.
                    Err(_) if self.members > 0 => {
                        self.ended = true;
                        return Ok(());
                    }
                    Err(e) => return Err(e),
                }
            }

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
                    return self.feed_inner(&replay, out);
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
                // A gzip body may hold more members, each read in turn.
                if self.gzip {
                    self.members += 1;
                    self.decompress.reset(false);
                    self.trailer_left = 8;
                    self.gzip_header = Some(Vec::new());
                    continue;
                }
                self.ended = true;
                return Ok(());
            }
            // A full piece may have more output behind it, even once the input is used up.
            if (input.is_empty() && written < PIECE) || (read == 0 && written == 0) {
                return Ok(());
            }
        }
    }
}

/// The length of the gzip header `bytes` starts with (RFC 1952 2.3), None while more of it is
/// still to come.
/// `scanned` keeps how far the name and the comment have been searched for their ends, so a
/// header that comes a byte at a time is not searched again from its start each time.
fn gzip_header_len(bytes: &[u8], scanned: &mut [usize; 2]) -> Result<Option<usize>, String> {
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
    for (i, flag) in [GZIP_FNAME, GZIP_FCOMMENT].into_iter().enumerate() {
        if flags & flag != 0 {
            let from = len.max(scanned[i]);
            match bytes.get(from..).and_then(|rest| rest.iter().position(|&b| b == 0)) {
                Some(end) => len = from + end + 1,
                None => {
                    scanned[i] = bytes.len().max(len);
                    return Ok(None);
                }
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

    const TEST_LIMIT: usize = 1 << 20;
    use std::io::Write;

    fn decode_bytewise(encoding: &str, compressed: &[u8]) -> (Vec<u8>, usize) {
        let Decoding::Decoder(mut decoder) = Decoding::new(Some(encoding), TEST_LIMIT) else {
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
    fn output_buffered_past_a_piece_is_drained_when_the_input_runs_out() {
        // Raw deflate inflates more than a piece from the last of its input.
        let text: Vec<u8> =
            b"data: ".iter().chain(&[b'x'; 40_000]).chain(b"\n\n").copied().collect();
        let mut raw = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::best());
        raw.write_all(&text).unwrap();
        let Decoding::Decoder(mut decoder) = Decoding::new(Some("deflate"), TEST_LIMIT) else {
            panic!()
        };
        let mut out = Vec::new();
        decoder.feed(&raw.finish().unwrap(), &mut |piece| out.extend_from_slice(piece)).unwrap();
        assert_eq!(out, text);
    }

    #[test]
    fn a_gzip_name_that_never_ends_is_refused() {
        let Decoding::Decoder(mut decoder) = Decoding::new(Some("gzip"), TEST_LIMIT) else {
            panic!()
        };
        let header = [0x1f, 0x8b, 0x08, GZIP_FNAME, 0, 0, 0, 0, 0, 0];
        decoder.feed(&header, &mut |_| {}).unwrap();
        let mut refused = false;
        for _ in 0..MAX_GZIP_HEADER / 512 + 1 {
            if decoder.feed(&[b'a'; 512], &mut |_| {}).is_err() {
                refused = true;
                break;
            }
        }
        assert!(refused);
    }

    #[test]
    fn deflate_without_output_is_not_kept_past_the_limit() {
        // A zlib header, then empty stored blocks: valid deflate that never produces a byte.
        let empty_block = [0x00, 0x00, 0x00, 0xff, 0xff];
        let Decoding::Decoder(mut decoder) = Decoding::new(Some("deflate"), 1024) else {
            panic!()
        };
        decoder.feed(&[0x78, 0x9c], &mut |_| {}).unwrap();
        let mut result = Ok(());
        for _ in 0..1024 {
            result = decoder.feed(&empty_block, &mut |_| {});
            if result.is_err() {
                break;
            }
        }
        assert!(result.is_err(), "stopped once past the limit");
        assert!(decoder.unframed.len() <= 1024);
    }

    #[test]
    fn a_chunk_past_the_limit_is_decoded_when_it_gives_output() {
        let text = b"data: tick\n\n".repeat(400);
        let mut zlib = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::none());
        zlib.write_all(&text).unwrap();
        let body = zlib.finish().unwrap();
        assert!(body.len() > 1024);
        let Decoding::Decoder(mut decoder) = Decoding::new(Some("deflate"), 1024) else {
            panic!()
        };
        let mut out = Vec::new();
        decoder.feed(&body, &mut |piece| out.extend_from_slice(piece)).unwrap();
        assert_eq!(out, text);
    }

    #[test]
    fn every_gzip_member_is_read() {
        let mut body = Vec::new();
        for part in [&b"data: one\n\n"[..], b"data: two\n\n"] {
            let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
            gz.write_all(part).unwrap();
            body.extend(gz.finish().unwrap());
        }
        assert_eq!(decode_bytewise("gzip", &body).0, b"data: one\n\ndata: two\n\n");
        let Decoding::Decoder(mut decoder) = Decoding::new(Some("gzip"), TEST_LIMIT) else {
            panic!()
        };
        let mut out = Vec::new();
        decoder.feed(&body, &mut |piece| out.extend_from_slice(piece)).unwrap();
        assert_eq!(out, b"data: one\n\ndata: two\n\n", "in one chunk");
    }

    #[test]
    fn a_highly_compressed_body_comes_out_in_pieces() {
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
        gz.write_all(&vec![b'a'; 4 << 20]).unwrap();
        let compressed = gz.finish().unwrap();
        let Decoding::Decoder(mut decoder) = Decoding::new(Some("gzip"), TEST_LIMIT) else {
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
