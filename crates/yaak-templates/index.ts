export * from './bindings/parser';
import { Tokens } from './bindings/parser';
import { escape_template, parse_template, unescape_template } from './pkg';

export function parseTemplate(template: string) {
  return parse_template(template) as Tokens;
}

export function escapeTemplate(template: string) {
  return escape_template(template) as string;
}

export function unescapeTemplate(template: string) {
  return unescape_template(template) as string;
}
