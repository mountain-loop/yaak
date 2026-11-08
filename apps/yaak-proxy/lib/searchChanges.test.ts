import type { Flow, ModelPayload } from "@yaakapp-internal/proxy-lib";
import { describe, expect, test } from "vite-plus/test";
import { emptyWindow, type FlowWindow } from "./flowWindow";
import { changesFor } from "./searchChanges";

const none = () => {};

function write(id: string, matches: boolean, key = "k"): ModelPayload {
  return {
    model: { id, startedAt: "2026-11-07 12:00:00", updatedAt: "2026-11-07 12:00:00" } as Flow,
    change: { type: "upsert", created: false },
    search: { key, matches },
  };
}

describe("changesFor", () => {
  test("takes matching flows and drops those that stop matching", () => {
    const win: FlowWindow = { ...emptyWindow, flows: [write("a", true).model] };
    const kept = changesFor(
      "k",
      win,
      [write("a", false), write("b", true), write("c", false)],
      none,
    );
    expect(kept.map((c) => [c.model.id, c.change.type])).toEqual([
      ["a", "delete"],
      ["b", "upsert"],
    ]);
  });

  test("a flow that joins and stops matching in one batch leaves again", () => {
    const kept = changesFor("k", emptyWindow, [write("a", true), write("a", false)], none);
    expect(kept.map((c) => [c.model.id, c.change.type])).toEqual([
      ["a", "upsert"],
      ["a", "delete"],
    ]);
  });

  test("leaves flows matched against another search to be matched again", () => {
    const later: string[] = [];
    const kept = changesFor("k", emptyWindow, [write("a", true, "old")], (unknown) =>
      later.push(...unknown.map((c) => c.model.id)),
    );
    expect([kept, later]).toEqual([[], ["a"]]);
  });
});
