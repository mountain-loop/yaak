import { describe, expect, test } from "vite-plus/test";
import { eventDeltas, formatEventDelta, formatEventTime } from "./streamEvents";

describe("eventDeltas", () => {
  test("measures each event from the one before it", () => {
    const deltas = eventDeltas([
      { timestamp: "2026-11-06T09:30:00.000" },
      { timestamp: "2026-11-06T09:30:00.012" },
      { timestamp: "2026-11-06T09:30:01.512" },
      { timestamp: "2026-11-06T09:32:05.512" },
    ]);
    expect(deltas).toEqual([null, 12, 1500, 124_000]);
    expect(deltas.map(formatEventDelta)).toEqual(["", "+12 ms", "+1.5 s", "+2m 4s"]);
  });

  test("skips an undated event, measuring the next from the last dated one", () => {
    expect(
      eventDeltas([
        { timestamp: "2026-11-06T09:30:00.000" },
        { timestamp: null },
        { timestamp: "2026-11-06T09:30:00.250" },
      ]),
    ).toEqual([null, null, 250]);
  });

  test("never goes negative when timestamps tie or step back", () => {
    expect(
      eventDeltas([
        { timestamp: "2026-11-06T09:30:00.500" },
        { timestamp: "2026-11-06T09:30:00.400" },
      ]),
    ).toEqual([null, 0]);
  });

  test("reads timestamps with or without a zone as UTC", () => {
    expect(
      eventDeltas([
        { timestamp: "2026-11-06T09:30:00.000Z" },
        { timestamp: "2026-11-06T09:30:00.100" },
      ]),
    ).toEqual([null, 100]);
  });
});

describe("formatEventTime", () => {
  test("shows the local time of day to the millisecond", () => {
    const local = new Date(Date.UTC(2026, 10, 6, 9, 30, 0, 7));
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    const expected = `${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}.007`;
    expect(formatEventTime("2026-11-06T09:30:00.007")).toBe(expected);
    expect(formatEventTime(null)).toBe("");
  });
});
