pub fn escape_template(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        // Check if we're at "${["
        if i + 2 < chars.len() && chars[i] == '$' && chars[i + 1] == '{' && chars[i + 2] == '[' {
            // Count preceding backslashes
            let mut backslash_count = 0;
            let mut j = i;
            while j > 0 && chars[j - 1] == '\\' {
                backslash_count += 1;
                j -= 1;
            }

            // If odd number of backslashes, the $ is escaped
            // If even number (including 0), the $ is not escaped
            let already_escaped = backslash_count % 2 == 1;

            if already_escaped {
                // Already escaped, just add the current character
                result.push(chars[i]);
            } else {
                // Not escaped, add backslash before $
                result.push('\\');
                result.push(chars[i]);
            }
        } else {
            result.push(chars[i]);
        }
        i += 1;
    }
    result
}

pub fn unescape_template(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        // Check if we're at "\${["
        if i + 3 < chars.len()
            && chars[i] == '\\'
            && chars[i + 1] == '$'
            && chars[i + 2] == '{'
            && chars[i + 3] == '['
        {
            // Count preceding backslashes (before the current backslash)
            let mut backslash_count = 0;
            let mut j = i;
            while j > 0 && chars[j - 1] == '\\' {
                backslash_count += 1;
                j -= 1;
            }

            // If even number of preceding backslashes, this backslash escapes the $
            // If odd number, this backslash is itself escaped
            let escapes_dollar = backslash_count % 2 == 0;

            if escapes_dollar {
                // Skip the backslash, just add the $
                result.push(chars[i + 1]);
                i += 1; // Skip the backslash
            } else {
                // This backslash is escaped itself, keep it
                result.push(chars[i]);
            }
        } else {
            result.push(chars[i]);
        }
        i += 1;
    }

    result
}

#[cfg(test)]
mod tests {
    use crate::escape::{escape_template, unescape_template};

    #[test]
    fn test_escape_simple() {
        let input = r#"${[foo]}"#;
        let expected = r#"\${[foo]}"#;
        assert_eq!(escape_template(input), expected);
    }

    #[test]
    fn test_already_escaped() {
        let input = r#"\${[bar]}"#;
        let expected = r#"\${[bar]}"#;
        assert_eq!(escape_template(input), expected);
    }

    #[test]
    fn test_double_backslash() {
        let input = r#"\\${[bar]}"#;
        let expected = r#"\\\${[bar]}"#;
        assert_eq!(escape_template(input), expected);
    }

    #[test]
    fn test_escape_with_surrounding_text() {
        let input = r#"text ${[var]} more"#;
        let expected = r#"text \${[var]} more"#;
        assert_eq!(escape_template(input), expected);
    }

    #[test]
    fn test_preserve_already_escaped() {
        let input = r#"already \${[escaped]}"#;
        let expected = r#"already \${[escaped]}"#;
        assert_eq!(escape_template(input), expected);
    }

    #[test]
    fn test_multiple_occurrences() {
        let input = r#"${[one]} and ${[two]}"#;
        let expected = r#"\${[one]} and \${[two]}"#;
        assert_eq!(escape_template(input), expected);
    }

    #[test]
    fn test_mixed_escaped_and_unescaped() {
        let input = r#"mixed \${[esc]} and ${[unesc]}"#;
        let expected = r#"mixed \${[esc]} and \${[unesc]}"#;
        assert_eq!(escape_template(input), expected);
    }

    #[test]
    fn test_unescape_simple() {
        let input = r#"\${[foo]}"#;
        let expected = r#"${[foo]}"#;
        assert_eq!(unescape_template(input), expected);
    }

    #[test]
    fn test_unescape_with_text() {
        let input = r#"text \${[var]} more"#;
        let expected = r#"text ${[var]} more"#;
        assert_eq!(unescape_template(input), expected);
    }

    #[test]
    fn test_unescape_multiple() {
        let input = r#"\${[one]} and \${[two]}"#;
        let expected = r#"${[one]} and ${[two]}"#;
        assert_eq!(unescape_template(input), expected);
    }

    #[test]
    fn test_unescape_double_backslash() {
        let input = r#"\\\${[bar]}"#;
        let expected = r#"\\${[bar]}"#;
        assert_eq!(unescape_template(input), expected);
    }

    #[test]
    fn test_unescape_plain_text() {
        let input = r#"${[foo]}"#;
        let expected = r#"${[foo]}"#;
        assert_eq!(unescape_template(input), expected);
    }
}
