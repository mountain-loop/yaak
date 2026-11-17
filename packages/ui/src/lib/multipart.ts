/**
 * A forgiving multipart parser for viewing bodies, not for validating them. It follows RFC 2046
 * but shows whatever it can: a preamble before the first delimiter and an epilogue after the
 * last are skipped, LF line endings are accepted as well as CRLF, and a body cut off before its
 * closing delimiter still gives the parts that arrived.
 */

export interface MultipartHeader {
  name: string;
  value: string;
}

export interface MultipartPart {
  headers: MultipartHeader[];
  /** The part's `Content-Type` header as sent, or null when it has none */
  contentType: string | null;
  /** The lowercased type and subtype of `contentType`, like `application/json` */
  mediaType: string | null;
  /** The `name` parameter of `Content-Disposition` */
  name: string | null;
  /** The `filename` parameter of `Content-Disposition` */
  filename: string | null;
  /** The `Content-ID` header, without angle brackets */
  contentId: string | null;
  body: Uint8Array;
}

export interface MultipartParseResult {
  parts: MultipartPart[];
  /** Whether the closing `--boundary--` delimiter was found */
  complete: boolean;
}

export interface HttpMessage {
  /** `HTTP/1.1 200 OK` or `GET /path HTTP/1.1`, as sent */
  startLine: string;
  /** The status code, for a response */
  status: number | null;
  /** The reason phrase, for a response */
  statusReason: string | null;
  /** The method, for a request */
  method: string | null;
  /** The target, for a request */
  url: string | null;
  headers: MultipartHeader[];
  body: Uint8Array;
}

const CR = 0x0d;
const LF = 0x0a;
const DASH = 0x2d;
const SPACE = 0x20;
const TAB = 0x09;

const encoder = new TextEncoder();
const latin1 = new TextDecoder("latin1");
const utf8 = new TextDecoder("utf-8", { fatal: true });

/** Results already parsed, by the bytes and boundary they came from, for as long as those bytes live */
const parsed = new WeakMap<Uint8Array, Map<string, MultipartParseResult>>();

/**
 * The boundary from a `Content-Type` header, or from a value cut out of one, without quotes or
 * the parameters that follow it. Null when there is none.
 */
export function boundaryFromContentType(contentType: string | null | undefined): string | null {
  if (contentType == null) return null;
  const boundary = headerParams(contentType).get("boundary");
  return boundary == null || boundary === "" ? null : boundary;
}

/**
 * A boundary as it appears after `--`: surrounding quotes removed, escapes undone, and anything
 * after an unquoted `;` dropped, so a value like `"a b"; charset=x` gives `a b`. A boundary can't
 * hold `"` or `;`, so normalizing one that already is gives it back unchanged, leading spaces and
 * all.
 */
export function normalizeBoundary(boundary: string | null | undefined): string | null {
  if (boundary == null) return null;
  let value = boundary;
  if (value.trimStart().startsWith('"')) {
    const end = /^"((?:[^"\\]|\\.)*)"/.exec(value.trimStart());
    value = end != null ? end[1]!.replace(/\\(.)/g, "$1") : value.trimStart().slice(1);
  } else {
    // Trailing whitespace isn't part of a boundary (RFC 2046)
    value = value.split(";")[0]!.trimEnd();
  }
  return value === "" ? null : value;
}

/** Parses a multipart body, made once for the same bytes and boundary */
export function parseMultipart(data: Uint8Array, rawBoundary: string): MultipartParseResult {
  const boundary = normalizeBoundary(rawBoundary) ?? rawBoundary;
  let byBoundary = parsed.get(data);
  const cached = byBoundary?.get(boundary);
  if (cached != null) return cached;

  const result = parseMultipartUncached(data, boundary);
  if (byBoundary == null) {
    byBoundary = new Map();
    parsed.set(data, byBoundary);
  }
  byBoundary.set(boundary, result);
  return result;
}

function parseMultipartUncached(data: Uint8Array, boundary: string): MultipartParseResult {
  const delimiter = encoder.encode(`--${boundary}`);

  // The first delimiter starts the body or a line; anything before it is preamble
  let start = findDelimiter(data, delimiter, 0);
  if (start < 0) {
    throw new Error(`No "--${boundary}" delimiter found`);
  }

  const parts: MultipartPart[] = [];
  for (;;) {
    let pos = start + delimiter.length;

    // `--boundary--` closes the body; whatever follows is epilogue
    if (data[pos] === DASH && data[pos + 1] === DASH) {
      return { parts, complete: true };
    }

    // Transport padding, then the line break that ends the delimiter line
    while (data[pos] === SPACE || data[pos] === TAB) pos++;
    if (data[pos] === CR) pos++;
    if (data[pos] === LF) pos++;

    if (pos >= data.length) {
      return { parts, complete: false };
    }

    const next = findDelimiter(data, delimiter, pos);
    if (next < 0) {
      // Cut off before the next delimiter: the rest is the last part, as far as it got
      parts.push(parsePart(data.subarray(pos)));
      return { parts, complete: false };
    }

    // The line break before a delimiter belongs to the delimiter, not the part
    const end = next === pos ? pos : lineStart(data, next);
    parts.push(parsePart(data.subarray(pos, end)));
    start = next;
  }
}

/**
 * Where the next delimiter at the start of a line begins, at or after `from`, or -1. A match must
 * be followed by `--`, whitespace, a line break or the end of the data, so a longer boundary that
 * merely starts with this one isn't taken for it.
 */
function findDelimiter(data: Uint8Array, delimiter: Uint8Array, from: number): number {
  let i = data.indexOf(delimiter[0]!, from);
  while (i >= 0 && i + delimiter.length <= data.length) {
    if (
      (i === 0 || data[i - 1] === LF) &&
      matchesAt(data, delimiter, i) &&
      endsDelimiter(data, i + delimiter.length)
    ) {
      return i;
    }
    i = data.indexOf(delimiter[0]!, i + 1);
  }
  return -1;
}

function matchesAt(data: Uint8Array, needle: Uint8Array, at: number): boolean {
  for (let j = 0; j < needle.length; j++) {
    if (data[at + j] !== needle[j]) return false;
  }
  return true;
}

/**
 * Whether the rest of the line after a boundary completes a delimiter: an optional `--` for the
 * closing one, optional transport padding, then a line break or the end of the data. So with
 * boundary `b`, neither `--b-suffix` nor `--b--suffix` is a delimiter.
 */
function endsDelimiter(data: Uint8Array, at: number): boolean {
  let pos = at;
  if (data[pos] === DASH && data[pos + 1] === DASH) pos += 2;
  while (data[pos] === SPACE || data[pos] === TAB) pos++;
  if (pos >= data.length) return true;
  if (data[pos] === LF) return true;
  return data[pos] === CR && (pos + 1 >= data.length || data[pos + 1] === LF);
}

/** The start of the line break before `at` (CRLF or LF), or `at` when there is none */
function lineStart(data: Uint8Array, at: number): number {
  if (at > 0 && data[at - 1] === LF) {
    return at > 1 && data[at - 2] === CR ? at - 2 : at - 1;
  }
  return at;
}

function parsePart(bytes: Uint8Array): MultipartPart {
  const { headers, body } = splitHeaders(bytes);
  const contentType = headerValue(headers, "content-type");
  const disposition = headerParams(headerValue(headers, "content-disposition") ?? "");
  const contentId = headerValue(headers, "content-id");
  const extendedFilename = disposition.get("filename*");
  return {
    headers,
    contentType,
    mediaType: mediaTypeOf(contentType),
    name: disposition.get("name") ?? null,
    filename:
      extendedFilename != null
        ? decodeExtendedValue(extendedFilename)
        : (disposition.get("filename") ?? null),
    contentId: contentId == null ? null : contentId.replace(/^<(.*)>$/, "$1"),
    body,
  };
}

/**
 * Splits a header block from the body after it, at the first blank line. A part that starts with
 * a blank line has no headers.
 */
function splitHeaders(bytes: Uint8Array): { headers: MultipartHeader[]; body: Uint8Array } {
  let pos = 0;
  const lines: string[] = [];
  for (;;) {
    const lf = bytes.indexOf(LF, pos);
    const lineEnd = lf < 0 ? bytes.length : lf;
    const contentEnd = lineEnd > pos && bytes[lineEnd - 1] === CR ? lineEnd - 1 : lineEnd;
    if (contentEnd === pos) {
      // A blank line ends the headers; without one, it was all headers and no body
      pos = lf < 0 ? bytes.length : lf + 1;
      break;
    }
    const line = decodeHeaderLine(bytes.subarray(pos, contentEnd));
    if (lines.length === 0 && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+\s*:/.test(line)) {
      // Not a header, so a part sent without its blank line: all of it is body
      return { headers: [], body: bytes };
    }
    lines.push(line);
    if (lf < 0) {
      pos = bytes.length;
      break;
    }
    pos = lf + 1;
  }

  const headers: MultipartHeader[] = [];
  for (const line of lines) {
    const last = headers[headers.length - 1];
    if ((line.startsWith(" ") || line.startsWith("\t")) && last != null) {
      // A folded line continues the header before it
      last.value = `${last.value} ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers.push({ name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() });
  }
  return { headers, body: bytes.subarray(pos) };
}

/**
 * Parses an `application/http` part: a request or response line, its headers and its body. Null
 * when the bytes don't start with one.
 */
export function parseHttpMessage(bytes: Uint8Array): HttpMessage | null {
  // Leading blank lines are tolerated, as HTTP/1.1 servers do
  let start = 0;
  while (bytes[start] === CR || bytes[start] === LF) start++;
  const lf = bytes.indexOf(LF, start);
  const lineEnd = lf < 0 ? bytes.length : lf;
  const startLine = latin1
    .decode(
      bytes.subarray(start, lineEnd > start && bytes[lineEnd - 1] === CR ? lineEnd - 1 : lineEnd),
    )
    .trim();

  const response = /^(HTTP\/\d(?:\.\d)?)\s+(\d{3})(?:\s+(.*))?$/i.exec(startLine);
  const request = /^([A-Z]+)\s+(\S+)(?:\s+HTTP\/\d(?:\.\d)?)?$/.exec(startLine);
  if (response == null && request == null) return null;

  const rest = lf < 0 ? new Uint8Array() : bytes.subarray(lf + 1);
  const { headers, body } = splitHeaders(rest);
  return {
    startLine,
    status: response != null ? Number(response[2]) : null,
    statusReason: response?.[3]?.trim() || null,
    method: response == null ? (request?.[1] ?? null) : null,
    url: response == null ? (request?.[2] ?? null) : null,
    headers,
    body,
  };
}

/** A header line as UTF-8, as browsers send form field names, or Latin-1 when it isn't valid UTF-8 */
function decodeHeaderLine(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    return latin1.decode(bytes);
  }
}

export function headerValue(headers: MultipartHeader[], name: string): string | null {
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value ?? null;
}

function mediaTypeOf(contentType: string | null): string | null {
  if (contentType == null) return null;
  const essence = contentType.split(";")[0]!.trim().toLowerCase();
  return essence === "" ? null : essence;
}

/**
 * The parameters after a header's first `;`, like `form-data; name="a"; filename="b.txt"`, by
 * lowercased name and unquoted. A quoted value may hold `;` and `=` without ending it.
 */
function headerParams(header: string): Map<string, string> {
  const params = new Map<string, string>();
  let i = header.indexOf(";");
  if (i < 0) return params;
  while (i < header.length) {
    // Past the `;` and whitespace, then the name up to `=` or the next `;`
    while (i < header.length && (header[i] === ";" || header[i] === " " || header[i] === "\t")) i++;
    const nameStart = i;
    while (i < header.length && header[i] !== "=" && header[i] !== ";") i++;
    const name = header.slice(nameStart, i).trim().toLowerCase();
    if (header[i] !== "=") continue;
    i++;
    while (header[i] === " " || header[i] === "\t") i++;
    let value = "";
    if (header[i] === '"') {
      i++;
      while (i < header.length && header[i] !== '"') {
        if (header[i] === "\\" && i + 1 < header.length) i++;
        value += header[i];
        i++;
      }
      // Past the closing quote and anything up to the next parameter
      while (i < header.length && header[i] !== ";") i++;
    } else {
      const valueStart = i;
      while (i < header.length && header[i] !== ";") i++;
      value = header.slice(valueStart, i).trim();
    }
    if (name !== "" && !params.has(name)) params.set(name, value);
  }
  return params;
}

/** An RFC 5987 extended value, `charset'language'percent-encoded`, decoded in its charset */
function decodeExtendedValue(value: string): string {
  const ext = /^([^']*)'[^']*'(.*)$/.exec(value);
  if (ext == null) return value;
  const encoded = ext[2]!;
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i++) {
    const hex = encoded.slice(i + 1, i + 3);
    if (encoded[i] === "%" && /^[0-9a-f]{2}$/i.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(encoded.charCodeAt(i) & 0xff);
    }
  }
  try {
    return new TextDecoder(ext[1]!.trim() || "utf-8").decode(new Uint8Array(bytes));
  } catch {
    return encoded;
  }
}

/** Whether bytes look binary: not valid UTF-8, or holding NUL or other control bytes */
export function isProbablyBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192);
  for (const b of sample) {
    if (b === 0) return true;
    if (b < 0x20 && b !== TAB && b !== LF && b !== CR && b !== 0x0c && b !== 0x1b) return true;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return false;
  } catch {
    return true;
  }
}
