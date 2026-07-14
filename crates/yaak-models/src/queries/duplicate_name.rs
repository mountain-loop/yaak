/// Compute a name for a duplicated model that doesn't conflict with any sibling
/// name, following the " Copy N" convention. Empty names are kept empty so the
/// display falls back to the URL.
pub(crate) fn conflict_free_name(name: &str, sibling_names: &[String]) -> String {
    if name.is_empty() {
        return String::new();
    }

    let mut name = name.to_string();
    for _ in 0..100 {
        if !sibling_names.contains(&name) {
            break;
        }
        name = next_copy_name(&name);
    }
    name
}

fn next_copy_name(name: &str) -> String {
    if let Some(base) = name.strip_suffix(" Copy") {
        return format!("{base} Copy 2");
    }

    if let Some(idx) = name.rfind(" Copy ") {
        let n = &name[idx + " Copy ".len()..];
        if !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()) {
            if let Ok(n) = n.parse::<u64>() {
                return format!("{} Copy {}", &name[..idx], n + 1);
            }
        }
    }

    format!("{name} Copy")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_next_copy_name() {
        assert_eq!(next_copy_name("Foo"), "Foo Copy");
        assert_eq!(next_copy_name("Foo Copy"), "Foo Copy 2");
        assert_eq!(next_copy_name("Foo Copy 2"), "Foo Copy 3");
        assert_eq!(next_copy_name("Foo Copy 99"), "Foo Copy 100");
        assert_eq!(next_copy_name("Copy"), "Copy Copy");
    }

    #[test]
    fn test_conflict_free_name() {
        let siblings = vec!["Foo".to_string(), "Foo Copy".to_string(), "".to_string()];
        assert_eq!(conflict_free_name("Foo", &siblings), "Foo Copy 2");
        assert_eq!(conflict_free_name("Bar", &siblings), "Bar");
        assert_eq!(conflict_free_name("", &siblings), "");
    }
}
