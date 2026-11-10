import { describe, expect, test, vi } from "vite-plus/test";
import { flowPrettyView, shownViewMode } from "./FlowBodyViewer";

// The package's index reaches for the window as it loads; the view rule is all this needs.
vi.mock("@yaakapp-internal/ui", async () => {
  const { prettyViewFor } = await vi.importActual<
    typeof import("../../../packages/ui/src/components/http/BodyViewModeSwitch")
  >("../../../packages/ui/src/components/http/BodyViewModeSwitch");
  return { prettyViewFor, LARGE_BODY_BYTES: 2_000_000 };
});

const text = (mime: string, language: string | null, which: "request" | "response" = "response") =>
  flowPrettyView({
    which,
    mime,
    text: "x",
    binary: false,
    language: language as never,
    hasForm: false,
  });

describe("flowPrettyView", () => {
  test("names the formatted view per format, the same on both halves", () => {
    for (const which of ["request", "response"] as const) {
      expect(text("application/json", "json", which)).toBe("formatted");
      expect(text("text/csv", "text", which)).toBe("table");
      expect(text("image/svg+xml", "xml", which)).toBe("preview");
    }
    expect(text("text/plain", "text")).toBeNull();
  });

  test("HTML previews as a response and formats as a request", () => {
    expect(text("text/html", "html", "response")).toBe("preview");
    expect(text("text/html", "html", "request")).toBe("formatted");
  });

  test("multipart has parts whether or not it reads as text", () => {
    const base = { which: "request" as const, mime: "multipart/form-data", language: null };
    expect(flowPrettyView({ ...base, text: null, binary: false, hasForm: false })).toBe("parts");
  });

  test("a URL-encoded form's fields are its formatted view, where the tab has them", () => {
    const base = {
      which: "request" as const,
      mime: "application/x-www-form-urlencoded",
      text: "a=1",
      binary: false,
      language: "text" as const,
    };
    expect(flowPrettyView({ ...base, hasForm: true })).toBe("form");
    expect(flowPrettyView({ ...base, hasForm: false })).toBeNull();
  });

  test("images, binary and undecodable bodies have one view", () => {
    const base = { which: "response" as const, language: null, hasForm: false };
    expect(flowPrettyView({ ...base, mime: "image/png", text: null, binary: true })).toBeNull();
    expect(
      flowPrettyView({ ...base, mime: "application/json", text: null, binary: true }),
    ).toBeNull();
    expect(
      flowPrettyView({ ...base, mime: "application/octet-stream", text: null, binary: false }),
    ).toBeNull();
  });
});

describe("shownViewMode", () => {
  test("follows the preference", () => {
    expect(shownViewMode({ key: "a", large: false, preferred: "pretty", chosen: null })).toBe(
      "pretty",
    );
    expect(shownViewMode({ key: "a", large: false, preferred: "raw", chosen: null })).toBe("raw");
  });

  test("a large body opens raw, and formats once asked, for that body alone", () => {
    expect(shownViewMode({ key: "a", large: true, preferred: "pretty", chosen: null })).toBe("raw");
    const chosen = { key: "a", mode: "pretty" as const };
    expect(shownViewMode({ key: "a", large: true, preferred: "pretty", chosen })).toBe("pretty");
    expect(shownViewMode({ key: "b", large: true, preferred: "pretty", chosen })).toBe("raw");
  });
});
