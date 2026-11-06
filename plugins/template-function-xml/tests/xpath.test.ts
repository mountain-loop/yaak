import type { Context } from "@yaakapp/api";
import { describe, expect, it } from "vite-plus/test";
import { filterXPath, plugin } from "../src";

const USERS =
  '<users><user id="42"><name>Alice</name></user><user id="7"><name>Bob</name></user></users>';

describe("xml.xpath", () => {
  const xpathFunction = plugin.templateFunctions?.find((f) => f.name === "xml.xpath");

  const select = async (query: string, result = "first", join = ", ") =>
    await xpathFunction?.onRender({} as Context, {
      values: { input: USERS, query, result, join },
      purpose: "send",
    });

  it("returns the text of a selected element", async () => {
    expect(await select("//user/name")).toBe("Alice");
  });

  it("returns the value of a selected attribute", async () => {
    expect(await select("//user/@id")).toBe("42");
  });

  it("joins the values of selected attributes", async () => {
    expect(await select("//user/@id", "join")).toBe("42, 7");
  });

  it("returns the value of a selected text node", async () => {
    expect(await select("//user/name/text()")).toBe("Alice");
  });

  it("returns the value of a selected CDATA section", () => {
    expect(filterXPath("<a><![CDATA[x<y]]></a>", "/a/text()", "first", null)).toBe("x<y");
  });
});
