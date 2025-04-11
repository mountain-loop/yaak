export * from './bindings/parser';
import { Tokens } from './bindings/parser';
import { parse_template } from './pkg';

export function parseTemplate(template: string) {
  return parse_template(template) as Tokens;
}
