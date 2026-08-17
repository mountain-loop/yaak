import { createStore } from "jotai";
import { expect, test } from "vitest";
import type { HttpResponseEvent } from "../bindings/gen_models";
import { httpResponseEventsAtom, modelStoreDataAtom } from "./atoms";
import { newStoreData } from "./util";

// The five setting events that every send writes, all within the same millisecond
const SETTING_NAMES = [
  "validate_certificates",
  "redirects",
  "timeout",
  "send_cookies",
  "store_cookies",
];

function settingEvent(id: string, name: string, createdAt: string): HttpResponseEvent {
  return {
    model: "http_response_event",
    id,
    createdAt,
    updatedAt: createdAt,
    workspaceId: "wk_1",
    responseId: "rs_1",
    event: { type: "setting", name, value: "true" },
  };
}

test("events with equal createdAt keep store (DB) insertion order", () => {
  const store = createStore();
  const data = newStoreData();
  SETTING_NAMES.forEach((name, i) => {
    data.http_response_event[`hre_${i}`] = settingEvent(
      `hre_${i}`,
      name,
      "2026-08-17T00:00:00.123",
    );
  });
  store.set(modelStoreDataAtom, data);

  const names = store.get(httpResponseEventsAtom).map((e) => {
    return e.event.type === "setting" ? e.event.name : e.event.type;
  });
  expect(names).toEqual(SETTING_NAMES);
});

test("events with distinct createdAt sort ascending", () => {
  const store = createStore();
  const data = newStoreData();
  for (const [id, createdAt] of [
    ["hre_b", "2026-08-17T00:00:00.456"],
    ["hre_a", "2026-08-17T00:00:00.123"],
    ["hre_c", "2026-08-17T00:00:00.789"],
  ]) {
    data.http_response_event[id!] = settingEvent(id!, "timeout", createdAt!);
  }
  store.set(modelStoreDataAtom, data);

  expect(store.get(httpResponseEventsAtom).map((e) => e.id)).toEqual(["hre_a", "hre_b", "hre_c"]);
});
