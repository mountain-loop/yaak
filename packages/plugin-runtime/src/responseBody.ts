import type { HttpResponseBody, ReadHttpResponseBodyOptions } from "@yaakapp/api";

/** Bytes pulled from the host per round trip, when the caller doesn't say. */
const DEFAULT_CHUNK_SIZE = 1024 * 1024;

/**
 * The most a plugin buffers by default.
 *
 * Reading a body used to be unbounded, so any ceiling is an improvement; this
 * one is set well above what an API returns and well below what makes the
 * plugin runtime fall over. `chunks()` has no ceiling, and any caller that
 * really wants the whole thing can raise `maxBytes`.
 */
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

/** Fetch one window of body bytes from the host. */
export type ReadResponseBodyChunk = (offset: number, length: number) => Promise<Uint8Array>;

export interface ResponseBodyInfo {
  responseId: string;
  contentLength: number;
  contentType: string | null;
}

export function createResponseBody(
  info: ResponseBodyInfo,
  readChunk: ReadResponseBodyChunk,
): HttpResponseBody {
  const { responseId, contentLength, contentType } = info;

  async function* chunks(
    options?: Pick<ReadHttpResponseBodyOptions, "chunkSize">,
  ): AsyncIterable<Uint8Array> {
    const chunkSize = Math.max(1, Math.floor(options?.chunkSize ?? DEFAULT_CHUNK_SIZE));
    let offset = 0;
    // Bounded by the length the host reported, but a short read still ends it:
    // the body may have been rewritten between the two calls.
    while (offset < contentLength) {
      const chunk = await readChunk(offset, Math.min(chunkSize, contentLength - offset));
      if (chunk.byteLength === 0) return;
      yield chunk;
      offset += chunk.byteLength;
    }
  }

  async function readAll(accessor: string, options?: ReadHttpResponseBodyOptions) {
    const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
    refuseIfTooBig(accessor, contentLength, maxBytes);

    const parts: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of chunks(options)) {
      total += chunk.byteLength;
      // The size the host reported is a claim about a moment ago, so check the
      // bytes actually arriving too.
      refuseIfTooBig(accessor, total, maxBytes);
      parts.push(chunk);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    return bytes;
  }

  return {
    responseId,
    contentLength,
    contentType,
    chunks,
    async arrayBuffer(options) {
      const bytes = await readAll("arrayBuffer", options);
      return bytes.buffer as ArrayBuffer;
    },
    async text(options) {
      return decodeBody(await readAll("text", options), contentType);
    },
    async json<T>(options?: ReadHttpResponseBodyOptions) {
      return JSON.parse(decodeBody(await readAll("json", options), contentType)) as T;
    },
  };
}

function refuseIfTooBig(accessor: string, bytes: number, maxBytes: number) {
  if (bytes <= maxBytes) return;
  throw new Error(
    `Response body is ${formatBytes(bytes)}, over the ${formatBytes(maxBytes)} limit for ` +
      `${accessor}(). Read it with chunks() instead, or pass a larger maxBytes.`,
  );
}

/**
 * Decode using the charset the response declared.
 *
 * Assuming UTF-8 mangles every response that isn't, and the header is right
 * there. An unknown label is the one case worth guessing on, since the
 * alternative is refusing to read a body we can very likely still read.
 */
function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  const charset = parseCharset(contentType);
  if (charset != null) {
    try {
      return new TextDecoder(charset).decode(bytes);
    } catch {
      // Not a label this runtime knows.
    }
  }
  // TextDecoder drops a leading BOM on its own.
  return new TextDecoder("utf-8").decode(bytes);
}

function parseCharset(contentType: string | null): string | null {
  const match = contentType?.match(/;\s*charset\s*=\s*"?([^";]+)"?/i);
  return match?.[1]?.trim() || null;
}

function formatBytes(bytes: number): string {
  if (bytes === Infinity) return "unlimited";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * Decode a chunk that arrived as base64.
 *
 * The desktop transport is a WebSocket carrying JSON text frames, so bytes
 * have to be spelled out. A host that can pass an ArrayBuffer along skips this.
 */
export function decodeBase64Chunk(data: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(data, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
