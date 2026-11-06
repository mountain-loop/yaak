use std::collections::BTreeMap;
use sxd_document::dom::{ChildOfElement, ChildOfRoot, Element, Text};
use sxd_document::parser;
use sxd_xpath::nodeset::Node;
use sxd_xpath::{Context, Factory, Value};

pub(crate) fn evaluate(text: &str, query: &str) -> Result<String, String> {
    let xpath = Factory::new()
        .build(query)
        .map_err(|e| format!("Invalid filter: {e}"))?
        .ok_or_else(|| "Invalid filter: empty expression".to_string())?;
    // sxd only takes a DOCTYPE after some prolog token, and whitespace is one.
    let text = if text.starts_with("<!DOCTYPE") { format!(" {text}") } else { text.to_string() };
    let package = parser::parse(&text).map_err(|e| format!("Invalid XML: {e}"))?;
    let document = package.as_document();
    for child in document.root().children() {
        if let ChildOfRoot::Element(e) = child {
            merge_adjacent_text(e);
        }
    }
    let value = xpath
        .evaluate(&Context::new(), document.root())
        .map_err(|e| format!("Invalid filter: {e}"))?;

    Ok(match value {
        Value::Nodeset(nodes) => {
            nodes.document_order().into_iter().map(serialize_node).collect::<Vec<_>>().join("\n")
        }
        Value::String(s) => s,
        Value::Boolean(b) => b.to_string(),
        Value::Number(n) => crate::jsonpath::number_to_string(n),
    })
}

/// The parser splits text at every entity and CDATA section; XPath sees one text node.
fn merge_adjacent_text(element: Element) {
    let mut previous: Option<Text> = None;
    for child in element.children() {
        match child {
            ChildOfElement::Text(text) => match previous {
                Some(previous) => {
                    previous.set_text(&format!("{}{}", previous.text(), text.text()));
                    text.remove_from_parent();
                }
                None => previous = Some(text),
            },
            ChildOfElement::Element(e) => {
                previous = None;
                merge_adjacent_text(e);
            }
            ChildOfElement::Comment(_) | ChildOfElement::ProcessingInstruction(_) => {
                previous = None
            }
        }
    }
}

/// Namespace declarations already written, keyed by prefix (`None` is the default).
type Scope<'d> = BTreeMap<Option<&'d str>, &'d str>;

fn serialize_node(node: Node) -> String {
    let mut out = String::new();
    match node {
        Node::Root(root) => {
            for child in root.children() {
                match child {
                    ChildOfRoot::Element(e) => write_element(&mut out, e, &Scope::new()),
                    ChildOfRoot::Comment(c) => write_comment(&mut out, c.text()),
                    ChildOfRoot::ProcessingInstruction(pi) => {
                        write_pi(&mut out, pi.target(), pi.value())
                    }
                }
            }
        }
        Node::Element(e) => write_element(&mut out, e, &Scope::new()),
        Node::Attribute(a) => {
            let name = node.prefixed_name().unwrap_or_else(|| a.name().local_part().to_string());
            write_attribute(&mut out, &name, a.value());
        }
        Node::Text(t) => escape_into(&mut out, t.text(), false),
        Node::Comment(c) => write_comment(&mut out, c.text()),
        Node::ProcessingInstruction(pi) => write_pi(&mut out, pi.target(), pi.value()),
        Node::Namespace(ns) => {
            write_attribute(&mut out, &format!("xmlns:{}", ns.prefix()), ns.uri())
        }
    }
    out
}

/// Elements declare the namespaces they use where they first need them, as xmldom does.
fn write_element<'d>(out: &mut String, element: Element<'d>, parent_scope: &Scope<'d>) {
    let mut scope = parent_scope.clone();
    let mut declarations = Vec::new();
    let mut declare = |prefix: Option<&'d str>, uri: &'d str| {
        if prefix != Some("xml") && scope.get(&prefix) != Some(&uri) {
            scope.insert(prefix, uri);
            declarations.push((prefix, uri));
        }
    };

    let name = element.name();
    let name = match name.namespace_uri() {
        Some(uri) => match element.prefix_for_namespace_uri(uri, element.preferred_prefix()) {
            Some(prefix) => {
                declare(Some(prefix), uri);
                format!("{prefix}:{}", name.local_part())
            }
            None => {
                declare(None, uri);
                name.local_part().to_string()
            }
        },
        None => {
            if parent_scope.get(&None).is_some_and(|uri| !uri.is_empty()) {
                declare(None, "");
            }
            name.local_part().to_string()
        }
    };

    let mut attributes = Vec::new();
    for attribute in element.attributes() {
        let attr_name = attribute.name();
        let prefix = attr_name.namespace_uri().and_then(|uri| {
            Some((element.prefix_for_namespace_uri(uri, attribute.preferred_prefix())?, uri))
        });
        let attr_name = match prefix {
            Some((prefix, uri)) => {
                declare(Some(prefix), uri);
                format!("{prefix}:{}", attr_name.local_part())
            }
            None => attr_name.local_part().to_string(),
        };
        attributes.push((attr_name, attribute.value()));
    }

    out.push('<');
    out.push_str(&name);
    for (attr_name, value) in attributes {
        out.push(' ');
        write_attribute(out, &attr_name, value);
    }
    for (prefix, uri) in declarations {
        out.push(' ');
        match prefix {
            Some(prefix) => write_attribute(out, &format!("xmlns:{prefix}"), uri),
            None => write_attribute(out, "xmlns", uri),
        }
    }

    let children = element.children();
    if children.is_empty() {
        out.push_str("/>");
        return;
    }
    out.push('>');
    for child in children {
        match child {
            ChildOfElement::Element(e) => write_element(out, e, &scope),
            ChildOfElement::Text(t) => escape_into(out, t.text(), false),
            ChildOfElement::Comment(c) => write_comment(out, c.text()),
            ChildOfElement::ProcessingInstruction(pi) => write_pi(out, pi.target(), pi.value()),
        }
    }
    out.push_str("</");
    out.push_str(&name);
    out.push('>');
}

fn write_attribute(out: &mut String, name: &str, value: &str) {
    out.push_str(name);
    out.push_str("=\"");
    escape_into(out, value, true);
    out.push('"');
}

fn write_comment(out: &mut String, text: &str) {
    out.push_str("<!--");
    out.push_str(text);
    out.push_str("-->");
}

fn write_pi(out: &mut String, target: &str, value: Option<&str>) {
    out.push_str("<?");
    out.push_str(target);
    if let Some(value) = value {
        out.push(' ');
        out.push_str(value);
    }
    out.push_str("?>");
}

fn escape_into(out: &mut String, text: &str, attribute: bool) {
    for c in text.chars() {
        match c {
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '&' => out.push_str("&amp;"),
            '"' if attribute => out.push_str("&quot;"),
            '\t' if attribute => out.push_str("&#9;"),
            '\n' if attribute => out.push_str("&#10;"),
            '\r' if attribute => out.push_str("&#13;"),
            c => out.push(c),
        }
    }
}
