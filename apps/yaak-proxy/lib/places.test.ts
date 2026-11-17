import { describe, expect, test } from "vite-plus/test";
import {
  addPlace,
  currentPlace,
  EMPTY_PLACE,
  MAX_PLACES,
  type Place,
  type PlaceStack,
  stackFromJson,
  stackOf,
  stackToJson,
  stackWithout,
  stepPlace,
  updatePlace,
  withoutMissing,
} from "./places";

function at(filter: string, selected: string[] = [], tabs: Place["tabs"] = {}): Place {
  return { filter, selection: new Set(selected), tabs };
}

function shown(stack: PlaceStack): string[] {
  return stack.places.map((p) => [p.filter, ...p.selection].join(":"));
}

describe("the place stack", () => {
  test("adds a place on top, and steps back and forward along them", () => {
    let stack = stackOf(EMPTY_PLACE);
    stack = addPlace(stack, at("a"));
    stack = addPlace(stack, at("a", ["f1"]));
    expect(shown(stack)).toEqual(["", "a", "a:f1"]);
    expect(stack.index).toBe(2);

    const back = stepPlace(stack, -1);
    expect(back == null ? null : currentPlace(back)).toEqual(at("a"));
    expect(stepPlace(stack, 1)).toBeNull();
    expect(stepPlace(stackOf(EMPTY_PLACE), -1)).toBeNull();
  });

  test("updating changes the current place without adding one", () => {
    let stack = addPlace(stackOf(EMPTY_PLACE), at("a", ["f1"]));
    stack = updatePlace(stack, at("a", ["f2"]));
    stack = updatePlace(stack, at("a", ["f2"], { response: "headers" }));
    expect(shown(stack)).toEqual(["", "a:f2"]);
    expect(currentPlace(stack).tabs).toEqual({ response: "headers" });
    // Nothing changed, nothing new.
    expect(updatePlace(stack, at("a", ["f2"], { response: "headers" }))).toBe(stack);
  });

  test("a click, a run of arrow keys and a new filter leave two places behind", () => {
    let stack = addPlace(stackOf(EMPTY_PLACE), at("before"));
    stack = addPlace(stack, at("before", ["A"]));
    for (let i = 1; i <= 50; i++) stack = updatePlace(stack, at("before", [`row${i}`]));
    stack = updatePlace(stack, at("before", ["B"]));
    stack = addPlace(stack, at("after", ["B"]));
    expect(shown(stack)).toEqual(["", "before", "before:B", "after:B"]);

    const one = stepPlace(stack, -1);
    expect(one == null ? null : currentPlace(one)).toEqual(at("before", ["B"]));
    const two = one == null ? null : stepPlace(one, -1);
    expect(two == null ? null : currentPlace(two)).toEqual(at("before"));
  });

  test("adding while back discards the places ahead", () => {
    let stack = addPlace(addPlace(stackOf(EMPTY_PLACE), at("a")), at("b"));
    stack = stepPlace(stack, -1) ?? stack;
    stack = addPlace(stack, at("c"));
    expect(shown(stack)).toEqual(["", "a", "c"]);
    expect(stepPlace(stack, 1)).toBeNull();
  });

  test("going where the window already is changes the current place, keeping those ahead", () => {
    let stack = addPlace(addPlace(stackOf(EMPTY_PLACE), at("a", ["f1"])), at("b"));
    stack = stepPlace(stack, -1) ?? stack;
    stack = addPlace(stack, at("a", ["f1"], { request: "body" }));
    expect(shown(stack)).toEqual(["", "a:f1", "b"]);
    expect(currentPlace(stack).tabs).toEqual({ request: "body" });
  });

  test("keeps the newest hundred", () => {
    let stack = stackOf(EMPTY_PLACE);
    for (let i = 0; i < MAX_PLACES + 20; i++) stack = addPlace(stack, at(`f${i}`));
    expect(stack.places.length).toBe(MAX_PLACES);
    expect(stack.index).toBe(MAX_PLACES - 1);
    expect(stack.places[0]?.filter).toBe("f20");
    expect(currentPlace(stack).filter).toBe(`f${MAX_PLACES + 19}`);
  });

  test("a flow that is gone leaves its places with their filters", () => {
    const place = at("a", ["gone"], { response: "headers" });
    expect(withoutMissing(place, () => false)).toEqual(at("a"));
    expect(withoutMissing(place, () => true)).toBe(place);

    const stack = addPlace(addPlace(stackOf(EMPTY_PLACE), place), at("b", ["kept"]));
    const after = stackWithout(stack, new Set(["gone"]));
    expect(shown(after)).toEqual(["", "a", "b:kept"]);
    expect(after.index).toBe(stack.index);
    expect(stackWithout(stack, new Set(["other"]))).toBe(stack);
  });
});

describe("the stack in storage", () => {
  test("reads back what it wrote", () => {
    const stack = addPlace(stackOf(at("a")), at("b", ["f1"], { request: "params" }));
    const read = stackFromJson(stackToJson(stack));
    expect(read).toEqual(stack);
    expect(read == null ? null : currentPlace(read).selection.has("f1")).toBe(true);
  });

  test("is nothing for anything else", () => {
    expect(stackFromJson(null)).toBeNull();
    expect(stackFromJson("not json")).toBeNull();
    expect(stackFromJson(JSON.stringify({ places: [], index: 0 }))).toBeNull();
    expect(stackFromJson(JSON.stringify({ places: [{ filter: 1 }], index: 0 }))).toBeNull();
  });

  test("keeps the index within its places", () => {
    const json = JSON.stringify({ places: [{ filter: "a", selection: [], tabs: {} }], index: 7 });
    expect(stackFromJson(json)?.index).toBe(0);
  });
});
