import type { Context } from "@yaakapp/api";
import { describe, expect, it } from "vite-plus/test";
import { plugin } from "../src";

const LF = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const CR = String.fromCharCode(13);

describe("json.escape", () => {
  const escapeFunction = plugin.templateFunctions?.find((f) => f.name === "json.escape");

  const escape = async (input: string) =>
    await escapeFunction!.onRender({} as Context, { values: { input } } as never);

  // The point of the function is that the result can be dropped between two
  // quotes in a JSON document, so that is what these assert.
  const embeds = (escaped: string | null) => {
    JSON.parse(`{"k":"${escaped}"}`);
    return JSON.parse(`{"k":"${escaped}"}`).k;
  };

  it("should exist", () => {
    expect(escapeFunction).toBeTruthy();
  });

  it("escapes a quote", async () => {
    const input = `say "hi"`;
    expect(embeds(await escape(input))).toBe(input);
  });

  it("escapes a backslash", async () => {
    const input = `a${String.fromCharCode(92)}b`;
    expect(embeds(await escape(input))).toBe(input);
  });

  it("escapes a newline", async () => {
    const input = `line1${LF}line2`;
    expect(embeds(await escape(input))).toBe(input);
  });

  it("escapes a tab and a carriage return", async () => {
    const input = `a${TAB}b${CR}c`;
    expect(embeds(await escape(input))).toBe(input);
  });

  it("round-trips a pretty-printed JSON document", async () => {
    const input = JSON.stringify({ name: `he said "hi"`, items: [1, 2] }, null, 2);
    expect(embeds(await escape(input))).toBe(input);
  });
});
