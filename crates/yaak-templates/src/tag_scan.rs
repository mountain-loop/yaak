use std::iter::Peekable;

/// Reads the single-quoted strings inside template tags, moving left to right through one text.
///
/// Kept as a struct rather than a free function because it remembers one thing between calls;
/// see [`TagStrings::take`].
#[derive(Default)]
pub(crate) struct TagStrings {
    /// Set once a scan has run off the end of the text, after which no string can close.
    none_left: bool,
}

impl TagStrings {
    /// Consumes the body of a single-quoted string, assuming the opening quote has already been
    /// read, and returns it (including the closing quote).
    ///
    /// Returns `None` when the quote is never closed, leaving the iterator untouched. The parser
    /// and the editor's Lezer grammar both only recognize a terminated `'…'`, so an unterminated
    /// quote has to stay an ordinary character and let the tag close at the next `]}`.
    ///
    /// Scanning forward from every quote would be quadratic on text full of unpaired quotes, so
    /// a failed scan is remembered: once one runs off the end, no later quote can open a
    /// terminated string either. Any unescaped quote after it would have closed the failed scan,
    /// so every remaining quote must be one the failed scan consumed as an escaped character —
    /// and a scan starting there continues from the same place, in the same state, to the same
    /// end. With that, every character of the text is read a bounded number of times.
    pub(crate) fn take<I>(&mut self, chars: &mut Peekable<I>) -> Option<String>
    where
        I: Iterator<Item = char> + Clone,
    {
        if self.none_left {
            return None;
        }

        let mut lookahead = chars.clone();
        let mut consumed = String::new();
        while let Some(c) = lookahead.next() {
            consumed.push(c);
            match c {
                // A backslash escapes whatever follows it, including a quote
                '\\' => match lookahead.next() {
                    Some(escaped) => consumed.push(escaped),
                    None => break,
                },
                '\'' => {
                    *chars = lookahead;
                    return Some(consumed);
                }
                _ => {}
            }
        }

        self.none_left = true;
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn take(text: &str) -> (Option<String>, String) {
        let mut chars = text.chars().peekable();
        let taken = TagStrings::default().take(&mut chars);
        (taken, chars.collect())
    }

    #[test]
    fn takes_a_terminated_string() {
        assert_eq!(take("abc' rest"), (Some("abc'".to_string()), " rest".to_string()));
    }

    #[test]
    fn takes_a_string_containing_a_tag_close() {
        assert_eq!(take("a]}b') ]}"), (Some("a]}b'".to_string()), ") ]}".to_string()));
    }

    #[test]
    fn takes_a_string_with_an_escaped_quote() {
        assert_eq!(take(r"it\'s' rest"), (Some(r"it\'s'".to_string()), " rest".to_string()));
    }

    #[test]
    fn leaves_an_unterminated_string_alone() {
        assert_eq!(take("oops ]}"), (None, "oops ]}".to_string()));
    }

    #[test]
    fn leaves_a_trailing_backslash_alone() {
        assert_eq!(take(r"oops\"), (None, r"oops\".to_string()));
    }

    #[test]
    fn stays_linear_on_many_unpaired_quotes() {
        // Every quote here is escaped, so none of them can ever close a string. Rescanning to
        // the end from each one would be quadratic, so this should finish in no time.
        let text = r"\'".repeat(20_000);
        let mut strings = TagStrings::default();
        let mut chars = text.chars().peekable();
        let started = Instant::now();

        let mut quotes = 0;
        while let Some(c) = chars.next() {
            if c == '\'' {
                quotes += 1;
                assert_eq!(strings.take(&mut chars), None);
            }
        }

        assert_eq!(quotes, 20_000);
        assert!(started.elapsed() < Duration::from_secs(1), "took {:?}", started.elapsed());
    }
}
