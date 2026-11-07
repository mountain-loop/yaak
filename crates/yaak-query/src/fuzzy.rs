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

    let search: Vec<char> = search.chars().collect();
    // One character that is not a substring can't match fuzzily either
    if search.len() == 1 || quoted {
        return false;
    }

    let target: Vec<char> = target.chars().collect();
    let skips = target_skips(&target);
    (0..skips.len() - 1).any(|skip| {
        target[skips[skip]] == search[0] && prefix_match(skip, &search, &target, &skips)
    })
}

/// fuzzbunny counts every char code from 127 up as alphanumeric.
fn is_alpha_num(c: char) -> bool {
    c.is_ascii_lowercase() || c.is_ascii_digit() || c as u32 >= 127
}

/// ASCII punctuation: `!` to `/`, `:` to `@`, `[` to `` ` ``, `{` to `~`.
fn is_punctuation(c: char) -> bool {
    matches!(c, '!'..='/' | ':'..='@' | '['..='`' | '{'..='~')
}

/// The indices where a word starts or a punctuation mark sits, then the target's length, so
/// every run lies between `skips[i]` and `skips[i + 1]`.
fn target_skips(target: &[char]) -> Vec<usize> {
    let mut skips = Vec::new();
    let mut was_alpha_num = false;
    for (i, &c) in target.iter().enumerate() {
        let alpha_num = is_alpha_num(c);
        if (alpha_num && !was_alpha_num) || is_punctuation(c) {
            skips.push(i);
        }
        was_alpha_num = alpha_num;
    }
    skips.push(target.len());
    skips
}

fn prefix_match(mut skip: usize, search: &[char], target: &[char], skips: &[usize]) -> bool {
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
            } else if t == ' ' {
                target_idx += 1;
            } else if s == ' ' {
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
