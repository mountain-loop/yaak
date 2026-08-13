/**
 * What a collapsed value turns out to be.
 *
 * Sniffing reads the head of the value only. A `data:` URI states its own media type, and raw
 * base64 gives up its type in the first few bytes, so neither needs the rest — which is the
 * point, since the whole reason these values are collapsed is that touching all of one costs
 * enough to stall the UI.
 */
export interface SniffedValue {
  /** Full media type, e.g. `image/png`. What the dialog routes on. */
  mime: string;
  /** A word for the tag, e.g. `PNG`. */
  label: string;
  /** Where the encoded payload starts in the value, past any `data:` header. */
  offset: number;
  encoding: "base64" | "percent";
}

/**
 * How much of a value {@link sniffValue} needs. Enough for a `data:` header of realistic
 * length, and far more than the 24 base64 characters the magic numbers are read from.
 */
export const SNIFF_HEAD_CHARS = 256;

/** Bytes the longest signature needs: `RIFF????WEBP`, and an ISO-BMFF brand at offset 8. */
const SNIFF_BYTES = 12;

/** `data:[<mime>][;<param>…],` — the payload follows the comma. */
const DATA_URI = /^data:([^,;]*)((?:;[^,;]*)*),/;

/** Media types that name no format, so the bytes are worth a look even when one is declared. */
const UNINFORMATIVE = ["", "application/octet-stream", "binary/octet-stream"];

interface Signature {
  label: string;
  mime: string;
  offset?: number;
  /** Byte values, where `null` matches anything */
  magic: readonly (number | null)[];
}

/**
 * A magic number written as the ASCII it reads as, with `?` for a byte that varies.
 *
 * Indexed rather than iterated, because a signature is a sequence of bytes: one character here
 * is one byte, and splitting into code points would be the wrong unit for that.
 */
function ascii(pattern: string): (number | null)[] {
  const bytes: (number | null)[] = [];
  for (let i = 0; i < pattern.length; i++) {
    bytes.push(pattern[i] === "?" ? null : pattern.charCodeAt(i));
  }
  return bytes;
}

const SIGNATURES: readonly Signature[] = [
  { label: "PNG", mime: "image/png", magic: [0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a] },
  { label: "JPEG", mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  { label: "GIF", mime: "image/gif", magic: ascii("GIF8") },
  { label: "BMP", mime: "image/bmp", magic: ascii("BM") },
  { label: "WEBP", mime: "image/webp", magic: ascii("RIFF????WEBP") },
  { label: "TIFF", mime: "image/tiff", magic: [...ascii("II"), 0x2a, 0x00] },
  { label: "TIFF", mime: "image/tiff", magic: [...ascii("MM"), 0x00, 0x2a] },
  { label: "ICO", mime: "image/x-icon", magic: [0x00, 0x00, 0x01, 0x00] },
  { label: "PDF", mime: "application/pdf", magic: ascii("%PDF-") },
  { label: "WAV", mime: "audio/wav", magic: ascii("RIFF????WAVE") },
  { label: "AVI", mime: "video/x-msvideo", magic: ascii("RIFF????AVI ") },
  { label: "MP3", mime: "audio/mpeg", magic: ascii("ID3") },
  // A bare MPEG frame header: 11 sync bits, then a layer III / II / I version pair
  { label: "MP3", mime: "audio/mpeg", magic: [0xff, 0xfb] },
  { label: "MP3", mime: "audio/mpeg", magic: [0xff, 0xf3] },
  { label: "MP3", mime: "audio/mpeg", magic: [0xff, 0xf2] },
  { label: "OGG", mime: "audio/ogg", magic: ascii("OggS") },
  { label: "FLAC", mime: "audio/flac", magic: ascii("fLaC") },
  { label: "WEBM", mime: "video/webm", magic: [0x1a, 0x45, 0xdf, 0xa3] },
  { label: "ZIP", mime: "application/zip", magic: [...ascii("PK"), 0x03, 0x04] },
  { label: "GZIP", mime: "application/gzip", magic: [0x1f, 0x8b] },
  { label: "7Z", mime: "application/x-7z-compressed", magic: [...ascii("7z"), 0xbc, 0xaf, 0x27] },
  { label: "RAR", mime: "application/vnd.rar", magic: ascii("Rar!") },
  { label: "GLTF", mime: "model/gltf-binary", magic: ascii("glTF") },
];

/**
 * ISO base media files all start `????ftyp`, so the format is in the brand that follows rather
 * than in the signature itself. Anything unlisted is some flavour of MP4.
 */
const ISO_BRANDS: Record<string, { mime: string; label: string }> = {
  avif: { mime: "image/avif", label: "AVIF" },
  avis: { mime: "image/avif", label: "AVIF" },
  heic: { mime: "image/heic", label: "HEIC" },
  heix: { mime: "image/heic", label: "HEIC" },
  hevc: { mime: "image/heic", label: "HEIC" },
  mif1: { mime: "image/heif", label: "HEIF" },
  msf1: { mime: "image/heif", label: "HEIF" },
  "M4A ": { mime: "audio/mp4", label: "M4A" },
  "qt  ": { mime: "video/quicktime", label: "MOV" },
};

function matches(bytes: Uint8Array, { magic, offset = 0 }: Signature): boolean {
  if (bytes.length < offset + magic.length) return false;
  return magic.every((b, i) => b == null || bytes[offset + i] === b);
}

function readAscii(bytes: Uint8Array, from: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(from, from + length));
}

/** The format the first bytes of a file identify it as, or null if they identify nothing. */
export function sniffBytes(bytes: Uint8Array): { mime: string; label: string } | null {
  if (readAscii(bytes, 4, 4) === "ftyp") {
    return ISO_BRANDS[readAscii(bytes, 8, 4)] ?? { mime: "video/mp4", label: "MP4" };
  }
  const sig = SIGNATURES.find((s) => matches(bytes, s));
  return sig == null ? null : { mime: sig.mime, label: sig.label };
}

/**
 * The first `bytes` bytes of a base64 payload, or null if it isn't base64 after all.
 *
 * Only the characters those bytes need are decoded. The trailing partial group is dropped
 * rather than padded, since `atob` rejects a group of one or two characters outright and we
 * have no use for the byte a three-character group would add.
 */
export function decodeBase64Prefix(text: string, offset: number, bytes: number): Uint8Array | null {
  const wanted = Math.ceil(bytes / 3) * 4;
  let b64 = text.slice(offset, offset + wanted);
  b64 = b64.slice(0, b64.length - (b64.length % 4));
  if (b64.length === 0) return null;

  // The URL-safe alphabet stands for the same bytes
  b64 = b64.replaceAll("-", "+").replaceAll("_", "/");
  if (!/^[A-Za-z0-9+/]+$/.test(b64)) return null;

  try {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * What a value is, from its head alone, or null if nothing recognises it.
 *
 * `head` need only be the first {@link SNIFF_HEAD_CHARS} characters — pass more and the rest is
 * ignored. The offsets in the result are relative to the start of the whole value.
 */
export function sniffValue(head: string): SniffedValue | null {
  const lead = head.length - head.trimStart().length;
  const value = head.slice(lead);

  const dataUri = DATA_URI.exec(value);
  if (dataUri != null) {
    const declared = dataUri[1]!.toLowerCase();
    const offset = lead + dataUri[0].length;
    if (!dataUri[2]!.split(";").includes("base64")) {
      // A percent-encoded payload states its own type or is text by definition
      const mime = declared === "" ? "text/plain" : declared;
      return { mime, label: labelForMime(mime), offset, encoding: "percent" };
    }
    if (!UNINFORMATIVE.includes(declared)) {
      return { mime: declared, label: labelForMime(declared), offset, encoding: "base64" };
    }
    return sniffBase64At(head, offset);
  }

  return sniffBase64At(head, lead);
}

function sniffBase64At(head: string, offset: number): SniffedValue | null {
  const bytes = decodeBase64Prefix(head, offset, SNIFF_BYTES);
  const sniffed = bytes == null ? null : sniffBytes(bytes);
  return sniffed == null ? null : { ...sniffed, offset, encoding: "base64" };
}

/** The shortest run of base64 that {@link isEncodedRun} will accept as convincing */
const ENCODED_RUN_CHARS = 64;

/**
 * Whether a value is one unbroken run of base64, rather than text that merely opens like it.
 *
 * A magic number is only a few bytes, so short ones match by chance — `BM` is two, which comes
 * up about once in every 65,000 values. That was harmless while a value had to be long enough
 * to hurt rendering before anything was hidden, and the sniff only chose the label. It is not
 * harmless when the sniff itself decides to hide something, so that rule asks for this as well:
 * prose leaves the alphabet within a few characters, and an encoded blob never does.
 */
export function isEncodedRun(head: string, offset: number): boolean {
  const run = head.slice(offset);
  return run.length >= ENCODED_RUN_CHARS && /^[A-Za-z0-9+/\-_]+={0,2}$/.test(run);
}

/** Subtypes whose own name makes a poor label */
const LABEL_OVERRIDES: Record<string, string> = {
  "text/plain": "TEXT",
};

/**
 * A word short enough for a tag. The distinguishing part of a subtype is its last dotted
 * segment before any `+suffix`, so `image/svg+xml` reads as SVG and `application/vnd.ms-excel`
 * as MS-EXCEL. Anything still too long falls back to the top-level type.
 */
export function labelForMime(mime: string): string {
  const override = LABEL_OVERRIDES[mime];
  if (override != null) {
    return override;
  }

  const [type, subtype] = mime.split("/");
  const word = (subtype ?? "").split("+")[0]!.split(".").pop()!.replace(/^x-/, "");
  if (word.length > 0 && word.length <= 10 && word !== "octet-stream") {
    return word.toUpperCase();
  }
  return (type ?? mime).toUpperCase();
}
