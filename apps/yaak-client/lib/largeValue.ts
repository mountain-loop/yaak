import { Icon } from "@yaakapp-internal/ui";
import mime from "mime";
import { createElement } from "react";
import type { DropdownItem } from "../components/core/Dropdown";
import type { SniffedValue } from "../components/core/Editor/sniffValue";
import { isEncodedRun } from "../components/core/Editor/sniffValue";
import { copyToClipboard } from "./copy";
import { fireAndForget } from "./fireAndForget";
import { rpc } from "./rpc";
import { showToast } from "./toast";
import { platform } from "@yaakapp-internal/platform";

/**
 * How the value is written, which is the thing worth knowing about it — that it is base64
 * explains why it reads as gibberish far better than its length does.
 *
 * A value we couldn't identify may still be plainly encoded, so it is checked here too: an
 * unrecognised format and an unrecognised encoding are different things to be told.
 *
 * `head` need only be the first {@link SNIFF_HEAD_CHARS} characters of the value.
 */
export function encodingLabel(head: string, sniffed: SniffedValue | null, chars: number): string {
  const size = `${chars.toLocaleString()} chars`;
  if (sniffed?.encoding === "percent") {
    return `Percent-encoded · ${size}`;
  }
  const encoded = sniffed?.encoding === "base64" || isEncodedRun(head, sniffed?.offset ?? 0);
  return encoded ? `Base64 · ${size}` : size;
}

interface ActionOptions {
  /** The whole value. A function, so opening a menu never copies megabytes to build it. */
  value: () => string;
  sniffed: SniffedValue | null;
  /** What to copy. The tag copies only what it hides; the viewer copies what it shows. */
  copyText: () => string;
  /** Left out inside the viewer itself, where there is nothing further to open */
  onView?: () => void;
}

/**
 * The things you can do with a collapsed value, as menu items.
 *
 * Shared so the tag in the editor and the dialog it opens offer the same list, rather than
 * drifting apart.
 */
export function largeValueActions({
  value,
  sniffed,
  copyText,
  onView,
}: ActionOptions): DropdownItem[] {
  const items: DropdownItem[] = [];

  if (onView != null) {
    items.push({
      label: sniffed == null ? "View" : `View ${sniffed.label}`,
      leftSlot: createElement(Icon, { icon: "eye" }),
      onSelect: onView,
    });
  }

  // Two ways to copy a picture, because either can be the one you wanted: the image to paste
  // somewhere that takes one, or the text to paste back into a request
  const image = isCopyableImage(sniffed);
  if (image) {
    items.push({
      label: "Copy Image",
      leftSlot: createElement(Icon, { icon: "copy" }),
      onSelect: () => copyImage(value(), sniffed, copyText()),
    });
  }

  items.push({
    label: sniffed?.encoding === "base64" ? "Copy Base64" : "Copy",
    // Second of a pair reads as one thing with two options, so it keeps the indent without
    // repeating the icon above it
    leftSlot: createElement(Icon, { icon: image ? "empty" : "copy" }),
    onSelect: () => copyToClipboard(copyText()),
  });

  items.push({
    label: "Save to File",
    leftSlot: createElement(Icon, { icon: "download" }),
    onSelect: () =>
      fireAndForget(saveValue(value(), sniffed, sniffed?.label.toLowerCase() ?? "value")),
  });

  return items;
}

/** The payload, with the `data:` header taken off. */
function payloadOf(text: string, sniffed: SniffedValue): string {
  return text.slice(sniffed.offset);
}

/**
 * A payload every strict base64 decoder will accept.
 *
 * The url-safe alphabet stands for the same bytes, and a ragged final group is dropped rather
 * than padded — it can only ever be worth a single byte, and both `atob` and the Rust decoder
 * behind the save command reject one outright.
 */
function normalizeBase64(payload: string): string {
  const clean = payload.replace(/\s+/g, "").replaceAll("-", "+").replaceAll("_", "/");
  return clean.slice(0, clean.length - (clean.length % 4));
}

/**
 * The bytes a collapsed value stands for.
 *
 * `atob` rather than `Uint8Array.fromBase64`, which is too new to rely on across the webviews we
 * ship on. Only ever called for something the user asked to see, never during layout.
 */
export function decodeValue(text: string, sniffed: SniffedValue): Uint8Array<ArrayBuffer> {
  const payload = payloadOf(text, sniffed);
  if (sniffed.encoding === "percent") {
    return new TextEncoder().encode(decodeURIComponent(payload));
  }

  const binary = atob(normalizeBase64(payload));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Whether the clipboard can take this as a picture rather than as text.
 *
 * SVG is left out on purpose: it is markup, so it pastes usefully as text, and rasterising it
 * would throw away the thing that makes it worth having.
 */
function isCopyableImage(sniffed: SniffedValue | null): sniffed is SniffedValue {
  return (
    sniffed != null && sniffed.mime.startsWith("image/") && !sniffed.mime.startsWith("image/svg")
  );
}

/**
 * The value as a PNG.
 *
 * Not a preference: PNG is the only image format the Clipboard API requires a browser to accept
 * on write — `text/plain`, `text/html` and `image/png` are the spec's mandatory data types — and
 * engines reject `image/jpeg` outright. So anything else is rasterised through a canvas, which
 * costs a decode and an encode but means a JPEG or a WEBP pastes just as readily as a PNG.
 *
 * `ClipboardItem.supports()` exists to ask whether a format could be written as it stands, and
 * skipping the conversion would be worth real time on a large photo. It was tried: WebKit says
 * no to `image/jpeg`, so the check only ever chose PNG and was removed again.
 *
 * The re-encode is lossless, so nothing is degraded, but a photograph lands on the clipboard far
 * larger than its JPEG. That matters less than it looks: the system pasteboard holds images
 * uncompressed regardless of what we hand it.
 */
async function toPngBlob(text: string, sniffed: SniffedValue): Promise<Blob> {
  const blob = new Blob([decodeValue(text, sniffed)], { type: sniffed.mime });
  if (sniffed.mime === "image/png") {
    return blob;
  }

  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (ctx == null) {
    throw new Error("Could not get a canvas to convert the image");
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (png) => (png == null ? reject(new Error("Could not encode the image")) : resolve(png)),
      "image/png",
    );
  });
}

/**
 * Puts the picture on the clipboard, so it can be pasted anywhere that takes an image.
 *
 * Not awaited, and deliberately so. The webview only allows a clipboard write that starts inside
 * the click that asked for it, and decoding a few megabytes takes longer than that lasts — so
 * the item is handed the still-pending promise rather than a finished blob.
 */
export function copyImage(text: string, sniffed: SniffedValue, fallback: string) {
  if (typeof ClipboardItem === "undefined") {
    copyToClipboard(fallback);
    return;
  }

  const png = toPngBlob(text, sniffed);
  navigator.clipboard
    .write([new ClipboardItem({ "image/png": png })])
    .then(() =>
      showToast({
        id: "copied",
        color: "success",
        icon: "copy",
        // Says PNG because that is what lands on the clipboard, whatever the value held
        message: "Copied as PNG",
      }),
    )
    .catch((err: unknown) => {
      // Anything from a webview that won't take an image to a file we couldn't decode. The
      // encoded text is always there to fall back on.
      console.error("Failed to copy image, copying text instead", err);
      copyToClipboard(fallback);
    });
}

/** Base64 of a byte array, in chunks so a few megabytes don't blow the argument limit. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Writes a collapsed value to a file the user picks.
 *
 * A value that is already base64 goes straight to the backend as-is — decoding it here only to
 * encode it again would walk megabytes twice for nothing.
 */
export async function saveValue(text: string, sniffed: SniffedValue | null, name: string) {
  const ext = sniffed == null ? "txt" : (mime.getExtension(sniffed.mime) ?? "bin");
  const filepath = await platform.dialog.save({ defaultPath: `${name}.${ext}`, title: "Save Value" });
  if (filepath == null) {
    return; // Cancelled
  }

  const data =
    sniffed == null
      ? toBase64(new TextEncoder().encode(text))
      : sniffed.encoding === "base64"
        ? normalizeBase64(payloadOf(text, sniffed))
        : toBase64(decodeValue(text, sniffed));

  await rpc("cmd_save_base64_to_binary", { filepath, data });
  showToast({ message: `Saved to ${filepath}` });
}
