//! Word-prefix matching, ported from fuzzbunny's `fuzzyMatchSanitized` so Yaak's sidebar keeps
//! the behaviour it had when it called fuzzbunny directly.
//!
//! A search matches when it is a substring of the target. Failing that, it matches when it can
//! be split into runs that each start a word or sit at a punctuation mark, in order: `mr` finds
//! "My Request", `usam` finds "United States of America", but `rq` does not find "request".
//! Spaces in either string never break a run.
//!
//! Only whether it matches is kept; fuzzbunny's scores and highlight ranges are not used.

/// Whether `search` matches `target`, both already lowercased and trimmed.
pub fn fuzzy_match(target: &str, search: &str) -> bool {
    fuzzy_match_in(target, search, &mut FuzzyScratch::default())
}

/// Buffers [`fuzzy_match_in`] reuses from one call to the next.
#[derive(Default)]
pub(crate) struct FuzzyScratch {
    target: Vec<char>,
    search: Vec<char>,
    skips: Vec<usize>,
}

/// [`fuzzy_match`], reusing `scratch` instead of allocating per call. ASCII text, the usual case,
/// is matched byte by byte without copying.
pub(crate) fn fuzzy_match_in(target: &str, search: &str, scratch: &mut FuzzyScratch) -> bool {
    if target.is_empty() {
        return false;
    }
    if search.is_empty() {
        return true;
    }

    // A search starting with a quote wants a substring only; the closing quote is optional
    let quoted = search.starts_with('"');
    let search = if quoted {
        let inner = &search[1..];
        inner.strip_suffix('"').unwrap_or(inner)
    } else {
        search
    };

    if target.contains(search) {
        return true;
    }

    // One character that is not a substring can't match fuzzily either
    let mut chars = search.chars();
    if quoted || (chars.next().is_some() && chars.next().is_none()) {
        return false;
    }

    let skips = &mut scratch.skips;
    if target.is_ascii() && search.is_ascii() {
        return word_prefix_match(target.as_bytes(), search.as_bytes(), skips);
    }
    scratch.target.clear();
    scratch.target.extend(target.chars());
    scratch.search.clear();
    scratch.search.extend(search.chars());
    word_prefix_match(&scratch.target, &scratch.search, skips)
}

/// A unit of text the matcher walks: a byte of ASCII text, or a char.
trait Unit: Copy + PartialEq {
    /// fuzzbunny counts lowercase letters, digits, and every char code from 127 up.
    fn is_alpha_num(self) -> bool;
    /// ASCII punctuation: `!` to `/`, `:` to `@`, `[` to `` ` ``, `{` to `~`.
    fn is_punctuation(self) -> bool;
    fn is_space(self) -> bool;
}

impl Unit for char {
    fn is_alpha_num(self) -> bool {
        self.is_ascii_lowercase() || self.is_ascii_digit() || self as u32 >= 127
    }

    fn is_punctuation(self) -> bool {
        matches!(self, '!'..='/' | ':'..='@' | '['..='`' | '{'..='~')
    }

    fn is_space(self) -> bool {
        self == ' '
    }
}

impl Unit for u8 {
    fn is_alpha_num(self) -> bool {
        (self as char).is_alpha_num()
    }

    fn is_punctuation(self) -> bool {
        (self as char).is_punctuation()
    }

    fn is_space(self) -> bool {
        self == b' '
    }
}

/// The word-prefix fallback, once `search` is known not to be a plain substring.
fn word_prefix_match<T: Unit>(target: &[T], search: &[T], skips: &mut Vec<usize>) -> bool {
    target_skips(target, skips);
    (0..skips.len() - 1)
        .any(|skip| target[skips[skip]] == search[0] && prefix_match(skip, search, target, skips))
}

/// The indices where a word starts or a punctuation mark sits, then the target's length, so
/// every run lies between `skips[i]` and `skips[i + 1]`.
fn target_skips<T: Unit>(target: &[T], skips: &mut Vec<usize>) {
    skips.clear();
    let mut was_alpha_num = false;
    for (i, &c) in target.iter().enumerate() {
        let alpha_num = c.is_alpha_num();
        if (alpha_num && !was_alpha_num) || c.is_punctuation() {
            skips.push(i);
        }
        was_alpha_num = alpha_num;
    }
    skips.push(target.len());
}

fn prefix_match<T: Unit>(mut skip: usize, search: &[T], target: &[T], skips: &[usize]) -> bool {
    let mut search_idx = 0;
    while skip < skips.len() - 1 {
        let mut target_idx = skips[skip];
        let end = skips[skip + 1];
        while target_idx < end && search_idx < search.len() {
            let t = target[target_idx];
            let s = search[search_idx];
            if t == s {
                target_idx += 1;
                search_idx += 1;
            } else if t.is_space() {
                target_idx += 1;
            } else if s.is_space() {
                search_idx += 1;
            } else {
                break;
            }
        }
        if search_idx == search.len() {
            return true;
        }
        skip += 1;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::fuzzy_match;

    fn m(target: &str, search: &str) -> bool {
        fuzzy_match(&target.to_lowercase(), &search.trim().to_lowercase())
    }

    #[test]
    fn substring_first() {
        assert!(m("My Request", "req"));
        assert!(m("My Request", "quest"));
        assert!(m("/v1/charges", "rges"));
        assert!(m("abc", "abc"));
    }

    #[test]
    fn word_prefixes() {
        assert!(m("My Request", "mr"));
        assert!(m("My Request", "myreq"));
        assert!(m("United States of America", "usam"));
        assert!(m("api.github.com", "apigi"));
        // Each run must continue from the start of a word: "gh" is not a prefix of "github"
        assert!(!m("api.github.com", "apigh"));
        assert!(m("POST Create User", "postcu"));
        assert!(m("get_user_by_id", "gubi"));
    }

    #[test]
    fn not_any_subsequence() {
        assert!(!m("My Request", "rq"));
        assert!(!m("request", "rqst"));
        assert!(!m("My Request", "mx"));
        assert!(!m("abc", "x"));
    }

    #[test]
    fn spaces_do_not_break_a_run() {
        assert!(m("My Request", "my r"));
        assert!(m("foo bar", "f b"));
    }

    #[test]
    fn empty_and_quoted() {
        assert!(!m("", "a"));
        assert!(m("abc", ""));
        assert!(m("las vegas", "\"la"));
        assert!(!m("los angeles", "\"la\""));
        assert!(m("los angeles", "la"));
    }

    #[test]
    fn unicode_is_alphanumeric() {
        assert!(m("Über Café", "üc"));
        assert!(m("日本 語", "日語"));
    }
}
