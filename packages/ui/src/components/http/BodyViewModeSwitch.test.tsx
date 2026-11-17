import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vite-plus/test";
import { ActionsBar } from "../ActionsBar";
import { IconButton } from "../IconButton";
import { BodyViewModeSwitch, prettyViewFor, viewModeLabels } from "./BodyViewModeSwitch";

describe("prettyViewFor", () => {
  test("names the formatted view for each format", () => {
    const cases: [string | null, string | null, boolean, string | null][] = [
      ["application/json", "json", false, "formatted"],
      ["application/xml", "xml", false, "formatted"],
      ["text/html", "html", false, "formatted"],
      ["text/html", "html", true, "preview"],
      ["text/csv", "text", false, "table"],
      ["text/tab-separated-values", "text", false, "table"],
      ["multipart/form-data", null, false, "parts"],
      ["image/svg+xml", "xml", false, "preview"],
    ];
    for (const [mimeType, language, previewHtml, expected] of cases) {
      expect(prettyViewFor({ mimeType, language, previewHtml }), `${mimeType}`).toBe(expected);
    }
  });

  test("a body with one view has no switch", () => {
    expect(prettyViewFor({ mimeType: "text/plain", language: "text" })).toBeNull();
    expect(prettyViewFor({ mimeType: null, language: "text" })).toBeNull();
    expect(prettyViewFor({ mimeType: "application/javascript", language: "javascript" })).toBe(
      null,
    );
  });

  test("a body's text decides over a missing content type", () => {
    expect(prettyViewFor({ mimeType: null, language: "json" })).toBe("formatted");
  });
});

describe("BodyViewModeSwitch", () => {
  test("its first state is named for the format, its second is Raw", () => {
    expect(viewModeLabels("formatted")).toEqual(["Pretty", "Raw"]);
    expect(viewModeLabels("table")).toEqual(["Table", "Raw"]);
    expect(viewModeLabels("parts")).toEqual(["Parts", "Raw"]);
    expect(viewModeLabels("preview")).toEqual(["Preview", "Raw"]);
    expect(viewModeLabels("form")).toEqual(["Form", "Raw"]);
  });

  test("marks the chosen state, and stays in view in an actions bar", () => {
    const pretty = renderToStaticMarkup(
      <BodyViewModeSwitch pretty="table" value="pretty" onChange={() => {}} />,
    );
    expect(pretty).toContain("data-pinned");
    expect(pretty).toMatch(/aria-checked="true"[^>]*>.*?Table/);
    expect(pretty).toMatch(/aria-checked="false"[^>]*>.*?Raw/);

    const raw = renderToStaticMarkup(
      <BodyViewModeSwitch pretty="table" value="raw" onChange={() => {}} />,
    );
    expect(raw).toMatch(/aria-checked="false"[^>]*>.*?Table/);
    expect(raw).toMatch(/aria-checked="true"[^>]*>.*?Raw/);
  });
});

describe("ActionsBar", () => {
  test("fades its actions in on hover, except a pinned one", () => {
    const markup = renderToStaticMarkup(
      <ActionsBar>
        <IconButton icon="filter" title="Filter" />
        <BodyViewModeSwitch pretty="formatted" value="pretty" onChange={() => {}} />
      </ActionsBar>,
    );
    expect(markup).toContain("[&amp;&gt;:not([data-pinned])]:opacity-0");
    expect(markup).toContain("group-hover/actions:*:opacity-100!");
    expect(markup).toContain('title="Filter"');
    expect(markup).toContain("data-pinned");
  });

  test("holds every action to one height and radius, centred on the row", () => {
    const markup = renderToStaticMarkup(
      <ActionsBar>
        <IconButton icon="filter" title="Filter" />
      </ActionsBar>,
    );
    expect(markup).toContain("items-center");
    expect(markup).toContain("*:h-sm");
    expect(markup).toContain("*:rounded-md");
  });

  test("the switch is sized to the bar's small icon buttons", () => {
    const markup = renderToStaticMarkup(
      <BodyViewModeSwitch pretty="formatted" value="pretty" onChange={() => {}} />,
    );
    expect(markup).toContain("h-sm!");
    expect(markup).toContain("[&amp;_[role=radio]]:h-full!");
  });
});
