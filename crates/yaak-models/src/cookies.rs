//! Carrying a send's cookie changes back into a jar.
//!
//! A send starts from a snapshot of the jar and hands back the jar as the
//! transaction left it. Writing that whole result over the jar would also
//! write over anything the user changed *while* the send was in flight — a
//! cookie edited or deleted in the jar view, or set by another send. So the
//! send's contribution is taken as a difference (what it added, changed, or
//! removed relative to its snapshot) and applied to whatever the jar holds now.

use crate::models::{Cookie, CookieDomain};

/// The identity of a cookie in a jar: two cookies with the same name, domain
/// and path are the same cookie, whatever their value or attributes.
type CookieKey = (String, CookieDomain, String);

fn key(c: &Cookie) -> CookieKey {
    (c.name.clone(), c.domain.clone(), c.path.clone())
}

/// Apply the changes between `before` (the snapshot a send started from) and
/// `after` (the jar as the send left it) to `current` (the jar as it is now).
///
/// Cookies the send removed are removed; cookies it added or changed replace
/// their counterpart in `current`, or are appended. Cookies the send did not
/// touch are left exactly as `current` has them.
pub fn apply_cookie_changes(
    current: Vec<Cookie>,
    before: &[Cookie],
    after: &[Cookie],
) -> Vec<Cookie> {
    let removed: Vec<CookieKey> =
        before.iter().filter(|b| !after.iter().any(|a| key(a) == key(b))).map(key).collect();
    let changed: Vec<&Cookie> = after.iter().filter(|a| !before.iter().any(|b| b == *a)).collect();

    let mut result: Vec<Cookie> =
        current.into_iter().filter(|c| !removed.contains(&key(c))).collect();
    for cookie in changed {
        match result.iter_mut().find(|c| key(c) == key(cookie)) {
            Some(existing) => *existing = cookie.clone(),
            None => result.push(cookie.clone()),
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::CookieExpires;

    fn cookie(name: &str, value: &str) -> Cookie {
        Cookie {
            name: name.to_string(),
            value: value.to_string(),
            domain: CookieDomain::HostOnly("example.com".to_string()),
            expires: CookieExpires::SessionEnd,
            path: "/".to_string(),
            secure: false,
            http_only: false,
            same_site: None,
        }
    }

    #[test]
    fn a_send_that_changed_nothing_leaves_the_jar_alone() {
        let before = vec![cookie("a", "1")];
        let current = vec![cookie("a", "edited"), cookie("b", "2")];
        assert_eq!(apply_cookie_changes(current.clone(), &before, &before), current);
    }

    #[test]
    fn additions_and_changes_land_without_touching_concurrent_edits() {
        let before = vec![cookie("a", "1"), cookie("b", "2")];
        let after = vec![cookie("a", "1"), cookie("b", "3"), cookie("c", "4")];
        // Meanwhile the user edited `a` and added `d`.
        let current = vec![cookie("a", "edited"), cookie("b", "2"), cookie("d", "5")];
        assert_eq!(
            apply_cookie_changes(current, &before, &after),
            vec![
                cookie("a", "edited"),
                cookie("b", "3"),
                cookie("d", "5"),
                cookie("c", "4")
            ]
        );
    }

    #[test]
    fn a_cookie_the_send_removed_is_removed() {
        let before = vec![cookie("a", "1"), cookie("b", "2")];
        let after = vec![cookie("b", "2")];
        let current = vec![cookie("a", "1"), cookie("b", "2"), cookie("c", "3")];
        assert_eq!(
            apply_cookie_changes(current, &before, &after),
            vec![cookie("b", "2"), cookie("c", "3")]
        );
    }

    #[test]
    fn a_cookie_the_user_deleted_mid_send_stays_deleted_unless_the_send_set_it() {
        let before = vec![cookie("a", "1")];
        let after = vec![cookie("a", "1")]; // untouched by the send
        assert_eq!(apply_cookie_changes(vec![], &before, &after), vec![]);
        let after = vec![cookie("a", "fresh")]; // the send set it again
        assert_eq!(apply_cookie_changes(vec![], &before, &after), vec![cookie("a", "fresh")]);
    }
}
