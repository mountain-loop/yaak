/**
 * Everything a plugin can reach that isn't the language itself. The Rust host
 * must install this same list; see the README.
 */

declare const __yaak_log: (level: string, message: string) => void;
declare const __yaak_timer_start: (id: number, ms: number) => void;
declare const __yaak_timer_cancel: (id: number) => void;

/* -------------------------------- console -------------------------------- */

/** Formatted in here, so only strings cross the boundary. */
function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
      try {
        return JSON.stringify(arg, replacer()) ?? String(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

function replacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_key, value) => {
    if (typeof value === "bigint") return `${value}n`;
    if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  };
}

function installConsole(): void {
  const log = (level: string) => (...args: unknown[]) => __yaak_log(level, formatArgs(args));
  (globalThis as Record<string, unknown>).console = {
    log: log("log"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    debug: log("debug"),
    trace: log("debug"),
  };
}

/* --------------------------------- timers -------------------------------- */

/** QuickJS has no clock to wake on, so the host holds the real timer. */
const timerCallbacks = new Map<number, () => void>();
let nextTimerId = 1;

function installTimers(): void {
  const g = globalThis as Record<string, unknown>;

  g.setTimeout = (callback: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const id = nextTimerId++;
    timerCallbacks.set(id, () => callback(...args));
    __yaak_timer_start(id, Math.max(0, Number(ms) || 0));
    return id;
  };

  g.clearTimeout = (id: number) => {
    if (!timerCallbacks.delete(id)) return;
    __yaak_timer_cancel(id);
  };

  // An interval is a timer that rearms, and nothing in a plugin should poll.
  g.setInterval = undefined;
  g.clearInterval = undefined;
}

/** Called by the host when a timer comes due. */
function fireTimer(id: number): void {
  const callback = timerCallbacks.get(id);
  timerCallbacks.delete(id);
  callback?.();
}

/* ------------------------------- text codecs ------------------------------ */

class SandboxTextEncoder {
  readonly encoding = "utf-8";

  encode(input = ""): Uint8Array {
    const out: number[] = [];
    for (let i = 0; i < input.length; i++) {
      let code = input.charCodeAt(i);
      // A lone surrogate becomes U+FFFD, as the standard encoder does.
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = input.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = (code - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
          i++;
        } else {
          code = 0xfffd;
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        code = 0xfffd;
      }

      if (code < 0x80) out.push(code);
      else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      else if (code < 0x10000)
        out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      else
        out.push(
          0xf0 | (code >> 18),
          0x80 | ((code >> 12) & 0x3f),
          0x80 | ((code >> 6) & 0x3f),
          0x80 | (code & 0x3f),
        );
    }
    return new Uint8Array(out);
  }
}

class SandboxTextDecoder {
  readonly encoding = "utf-8";

  decode(input?: ArrayBuffer | ArrayBufferView): string {
    if (input == null) return "";
    const bytes =
      input instanceof Uint8Array
        ? input
        : ArrayBuffer.isView(input)
          ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
          : new Uint8Array(input);

    let out = "";
    for (let i = 0; i < bytes.length; ) {
      const byte = bytes[i]!;
      let code: number;
      let size: number;
      if (byte < 0x80) {
        code = byte;
        size = 1;
      } else if ((byte & 0xe0) === 0xc0) {
        code = byte & 0x1f;
        size = 2;
      } else if ((byte & 0xf0) === 0xe0) {
        code = byte & 0x0f;
        size = 3;
      } else if ((byte & 0xf8) === 0xf0) {
        code = byte & 0x07;
        size = 4;
      } else {
        out += "�";
        i++;
        continue;
      }

      if (i + size > bytes.length) {
        out += "�";
        break;
      }
      for (let k = 1; k < size; k++) {
        const cont = bytes[i + k]!;
        if ((cont & 0xc0) !== 0x80) {
          code = -1;
          break;
        }
        code = (code << 6) | (cont & 0x3f);
      }
      i += size;

      if (code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) out += "�";
      else if (code < 0x10000) out += String.fromCharCode(code);
      else {
        const c = code - 0x10000;
        out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
      }
    }
    return out;
  }
}

function installTextCodecs(): void {
  const g = globalThis as Record<string, unknown>;
  g.TextEncoder = SandboxTextEncoder;
  g.TextDecoder = SandboxTextDecoder;
}

/* ------------------------------ base64 helpers ---------------------------- */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function installBase64(): void {
  const g = globalThis as Record<string, unknown>;

  g.btoa = (input: string): string => {
    let out = "";
    for (let i = 0; i < input.length; i += 3) {
      const a = input.charCodeAt(i);
      const b = input.charCodeAt(i + 1);
      const c = input.charCodeAt(i + 2);
      if (a > 0xff || b > 0xff || c > 0xff) {
        throw new Error("btoa: string contains characters outside of the Latin1 range");
      }
      const chunk = (a << 16) | ((Number.isNaN(b) ? 0 : b) << 8) | (Number.isNaN(c) ? 0 : c);
      out += B64[(chunk >> 18) & 63]! + B64[(chunk >> 12) & 63]!;
      out += Number.isNaN(b) ? "=" : B64[(chunk >> 6) & 63]!;
      out += Number.isNaN(c) ? "=" : B64[chunk & 63]!;
    }
    return out;
  };

  g.atob = (input: string): string => {
    const clean = input.replace(/[\t\n\f\r ]/g, "").replace(/=+$/, "");
    let out = "";
    let bits = 0;
    let acc = 0;
    for (const ch of clean) {
      const value = B64.indexOf(ch);
      if (value < 0) throw new Error("atob: string contains invalid characters");
      acc = (acc << 6) | value;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out += String.fromCharCode((acc >> bits) & 0xff);
      }
    }
    return out;
  };
}

export function installGlobals(): { fireTimer: (id: number) => void } {
  installConsole();
  installTimers();
  installTextCodecs();
  installBase64();
  return { fireTimer };
}
