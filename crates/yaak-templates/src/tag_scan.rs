use std::iter::Peekable;

/// Consumes the body of a single-quoted template-tag string, assuming the opening quote has
/// already been read, and returns it (including the closing quote).
///
/// Returns `None` when the quote is never closed, leaving the iterator untouched. The parser
/// and the editor's Lezer grammar both only recognize a terminated `'…'`, so an unterminated
/// quote has to stay an ordinary character and let the tag close at the next `]}`.
pub(crate) fn take_quoted_string<I>(chars: &mut Peekable<I>) -> Option<String>
where
    I: Iterator<Item = char> + Clone,
{
    let mut lookahead = chars.clone();
    let mut consumed = String::new();
    while let Some(c) = lookahead.next() {
        consumed.push(c);
        match c {
            // A backslash escapes whatever follows it, including a quote
            '\\' => consumed.push(lookahead.next()?),
            '\'' => {
                *chars = lookahead;
                return Some(consumed);
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn take(text: &str) -> (Option<String>, String) {
        let mut chars = text.chars().peekable();
        let taken = take_quoted_string(&mut chars);
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
}
