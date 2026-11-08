import type { Flow, ModelPayload } from "@yaakapp-internal/proxy-lib";
import { describe, expect, test } from "vite-plus/test";
import { emptyWindow, type FlowWindow } from "./flowWindow";
import { changesFor, FlowEvents } from "./searchChanges";

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

describe("FlowEvents", () => {
  test("drops a late answer for a flow a newer event removed, though the window no longer holds it", () => {
    const events = new FlowEvents();
    const old = write("a", true, "old");
    events.arrived([old]);
    // Under the new search the flow stops matching and leaves the window...
    events.arrived([write("a", false)]);
    // ...and the re-check of the old event answers after
    expect(events.current([old])).toEqual([]);
  });

  test("drops a late answer for a flow the sweep removed", () => {
    const events = new FlowEvents();
    const old = write("a", true, "old");
    events.arrived([old]);
    events.removed(["a"]);
    expect(events.current([old])).toEqual([]);
  });

  test("keeps an answer no newer event has passed, and one for other flows", () => {
    const events = new FlowEvents();
    const a = write("a", true, "old");
    const b = write("b", true, "old");
    events.arrived([a, b]);
    events.arrived([write("c", true)]);
    expect(events.current([a, b])).toEqual([a, b]);
    // Not noted: nothing to judge it by
    const unseen = write("d", true, "old");
    expect(events.current([unseen])).toEqual([unseen]);
  });

  test("past what it remembers, drops what it can no longer judge", () => {
    const events = new FlowEvents(2);
    const a = write("a", true, "old");
    events.arrived([a, write("b", true), write("c", true)]);
    expect(events.current([a])).toEqual([]);
    const c = write("c", true, "old");
    events.arrived([c]);
    expect(events.current([c])).toEqual([c]);
  });

  test("drops answers from before a clear", () => {
    const events = new FlowEvents();
    const a = write("a", true, "old");
    events.arrived([a]);
    events.reset();
    expect(events.current([a])).toEqual([]);
  });
});
