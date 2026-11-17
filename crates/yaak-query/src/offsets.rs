//! Byte offsets to UTF-16 offsets and back, for spans handed to JavaScript, which counts string
//! positions in UTF-16 code units.

use crate::ast::Span;

/// Byte offset to UTF-16 offset, and back, for one input.
pub struct Utf16Offsets {
    /// `utf16[i]` is the UTF-16 offset of byte `i`, for every char boundary and the end.
    utf16: Vec<u32>,
}

impl Utf16Offsets {
    pub fn new(input: &str) -> Self {
        let mut utf16 = vec![0; input.len() + 1];
        let mut units = 0u32;
        for (i, c) in input.char_indices() {
            for b in 0..c.len_utf8() {
                utf16[i + b] = units;
            }
            units += c.len_utf16() as u32;
        }
        utf16[input.len()] = units;
        Self { utf16 }
    }

    /// A byte span as a UTF-16 one.
    pub fn span(&self, span: Span) -> Span {
        Span { start: self.utf16[span.start()], end: self.utf16[span.end()] }
    }

    /// The byte offset of UTF-16 offset `pos`, or of the char it falls inside.
    pub fn byte(&self, pos: u32) -> usize {
        self.utf16.partition_point(|&u| u < pos).min(self.utf16.len() - 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_both_ways() {
        let input = "é@a:😀x";
        let offsets = Utf16Offsets::new(input);
        // `é` is two bytes and one unit; `😀` is four bytes and two units
        assert_eq!(offsets.span(Span::new(2, 5)), Span { start: 1, end: 4 });
        assert_eq!(offsets.span(Span::new(5, 10)), Span { start: 4, end: 7 });
        assert_eq!(offsets.byte(4), 5);
        assert_eq!(offsets.byte(6), 9);
        assert_eq!(offsets.byte(99), input.len());
    }
}
