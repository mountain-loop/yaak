// query.ts
// A tiny query language parser with NOT/AND/OR, parentheses, phrases, negation, and field:value.

import { fuzzyMatch } from 'fuzzbunny';
/////////////////////////
// AST
/////////////////////////

export type Ast =
  | { type: 'Term'; value: string } // foo
  | { type: 'Phrase'; value: string } // "hi there"
  | { type: 'Field'; field: string; value: string } // method:POST or title:"exact phrase"
  | { type: 'Not'; node: Ast } // -foo or NOT foo
  | { type: 'And'; left: Ast; right: Ast } // a AND b
  | { type: 'Or'; left: Ast; right: Ast }; // a OR b

/////////////////////////
// Tokenizer
/////////////////////////
type Tok =
  | { kind: 'LPAREN' }
  | { kind: 'RPAREN' }
  | { kind: 'AND' }
  | { kind: 'OR' }
  | { kind: 'NOT' } // explicit NOT
  | { kind: 'MINUS' } // unary minus before term/phrase/paren group
  | { kind: 'COLON' }
  | { kind: 'WORD'; text: string } // bareword (unquoted)
  | { kind: 'PHRASE'; text: string } // "quoted phrase"
  | { kind: 'EOF' };

const isSpace = (c: string) => /\s/.test(c);
const isIdent = (c: string) => /[A-Za-z0-9_\-./]/.test(c);

export function tokenize(input: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = input.length;

  const peek = () => input[i] ?? '';
  const advance = () => input[i++];

  const readWord = () => {
    let s = '';
    while (i < n && isIdent(peek())) s += advance();
    return s;
  };

  const readPhrase = () => {
    // assumes current char is opening quote
    advance(); // consume opening "
    let s = '';
    while (i < n) {
      const c = advance();
      if (c === `"`) break;
      if (c === '\\' && i < n) {
        // escape \" and \\ (simple)
        const next = advance();
        s += next;
      } else {
        s += c;
      }
    }
    return s;
  };

  while (i < n) {
    const c = peek();

    if (isSpace(c)) {
      i++;
      continue;
    }

    if (c === '(') {
      toks.push({ kind: 'LPAREN' });
      i++;
      continue;
    }
    if (c === ')') {
      toks.push({ kind: 'RPAREN' });
      i++;
      continue;
    }
    if (c === ':') {
      toks.push({ kind: 'COLON' });
      i++;
      continue;
    }
    if (c === `"`) {
      const text = readPhrase();
      toks.push({ kind: 'PHRASE', text });
      continue;
    }
    if (c === '-') {
      toks.push({ kind: 'MINUS' });
      i++;
      continue;
    }

    // WORD / AND / OR / NOT
    if (isIdent(c)) {
      const w = readWord();
      const upper = w.toUpperCase();
      if (upper === 'AND') toks.push({ kind: 'AND' });
      else if (upper === 'OR') toks.push({ kind: 'OR' });
      else if (upper === 'NOT') toks.push({ kind: 'NOT' });
      else toks.push({ kind: 'WORD', text: w });
      continue;
    }

    // Unknown char—skip to be forgiving
    i++;
  }

  toks.push({ kind: 'EOF' });
  return toks;
}

class Parser {
  private i = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok {
    return this.toks[this.i] ?? { kind: 'EOF' };
  }
  private advance(): Tok {
    return this.toks[this.i++] ?? { kind: 'EOF' };
  }
  private at(kind: Tok['kind']) {
    return this.peek().kind === kind;
  }

  // Top-level: parse OR-precedence chain, allowing implicit AND.
  parse(): Ast | null {
    if (this.at('EOF')) return null;
    const expr = this.parseOr();
    if (!this.at('EOF')) {
      // Optionally, consume remaining tokens or throw
    }
    return expr;
  }

  // Precedence: NOT (highest), AND, OR (lowest)
  private parseOr(): Ast {
    let node = this.parseAnd();
    while (this.at('OR')) {
      this.advance();
      const rhs = this.parseAnd();
      node = { type: 'Or', left: node, right: rhs };
    }
    return node;
  }

  private parseAnd(): Ast {
    let node = this.parseUnary();
    // Implicit AND: if next token starts a primary, treat as AND.
    while (this.at('AND') || this.startsPrimary()) {
      if (this.at('AND')) this.advance();
      const rhs = this.parseUnary();
      node = { type: 'And', left: node, right: rhs };
    }
    return node;
  }

  private parseUnary(): Ast {
    if (this.at('NOT') || this.at('MINUS')) {
      this.advance();
      const node = this.parseUnary();
      return { type: 'Not', node };
    }
    return this.parsePrimaryOrField();
  }

  private startsPrimary(): boolean {
    const k = this.peek().kind;
    return k === 'WORD' || k === 'PHRASE' || k === 'LPAREN' || k === 'MINUS' || k === 'NOT';
  }

  private parsePrimaryOrField(): Ast {
    // Parenthesized group
    if (this.at('LPAREN')) {
      this.advance();
      const inside = this.parseOr();
      // if (!this.at('RPAREN')) throw new Error("Missing closing ')'");
      this.advance();
      return inside;
    }

    // Phrase
    if (this.at('PHRASE')) {
      const t = this.advance() as Extract<Tok, { kind: 'PHRASE' }>;
      return { type: 'Phrase', value: t.text };
    }

    // Field or bare word
    if (this.at('WORD')) {
      const wordTok = this.advance() as Extract<Tok, { kind: 'WORD' }>;

      if (this.at('COLON')) {
        // field:value or field:"phrase"
        this.advance(); // :
        let value: string;
        if (this.at('PHRASE')) {
          const p = this.advance() as Extract<Tok, { kind: 'PHRASE' }>;
          value = p.text;
        } else if (this.at('WORD')) {
          const w = this.advance() as Extract<Tok, { kind: 'WORD' }>;
          value = w.text;
        } else {
          // Anything else after colon is treated literally as a single Term token.
          const t = this.advance();
          value = tokText(t);
        }
        return { type: 'Field', field: wordTok.text, value };
      }

      // plain term
      return { type: 'Term', value: wordTok.text };
    }

    const w = this.advance() as Extract<Tok, { kind: 'WORD' }>;
    return { type: 'Phrase', value: 'text' in w ? w.text : '' };
  }
}

function tokText(t: Tok): string {
  if ('text' in t) return t.text;

  switch (t.kind) {
    case 'COLON':
      return ':';
    case 'LPAREN':
      return '(';
    case 'RPAREN':
      return ')';
    default:
      return '';
  }
}

export function parseQuery(q: string): Ast | null {
  if (q.trim() === '') return null;
  const toks = tokenize(q);
  const parser = new Parser(toks);
  return parser.parse();
}

export type Doc = {
  text?: string;
  fields?: Record<string, unknown>;
};

type Technique = 'substring' | 'fuzzy' | 'strict';

function includes(hay: string | undefined, needle: string, technique: Technique): boolean {
  if (!hay || !needle) return false;
  else if (technique === 'strict') return hay === needle;
  else if (technique === 'fuzzy') return !!fuzzyMatch(hay, needle);
  else return hay.indexOf(needle) !== -1;
}

export function evaluate(ast: Ast | null, doc: Doc): boolean {
  if (!ast) return true; // Match everything if no query is provided

  const text = (doc.text ?? '').toLowerCase();
  const fieldsNorm: Record<string, string[]> = {};

  for (const [k, v] of Object.entries(doc.fields ?? {})) {
    if (!(typeof v === 'string' || Array.isArray(v))) continue;
    fieldsNorm[k.toLowerCase()] = Array.isArray(v)
      ? v.filter((v) => typeof v === 'string').map((s) => s.toLowerCase())
      : [String(v ?? '').toLowerCase()];
  }

  const evalNode = (node: Ast): boolean => {
    switch (node.type) {
      case 'Term':
        return includes(text, node.value.toLowerCase(), 'fuzzy');
      case 'Phrase':
        // Quoted phrases match exactly
        return includes(text, node.value.toLowerCase(), 'substring');
      case 'Field': {
        const vals = fieldsNorm[node.field.toLowerCase()] ?? [];
        if (vals.length === 0) return false;
        return vals.some((v) => includes(v, node.value.toLowerCase(), 'substring'));
      }
      case 'Not':
        return !evalNode(node.node);
      case 'And':
        return evalNode(node.left) && evalNode(node.right);
      case 'Or':
        return evalNode(node.left) || evalNode(node.right);
    }
  };

  return evalNode(ast);
}
