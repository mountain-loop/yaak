import { describe, expect, test } from "vite-plus/test";
import { isYaakUrl } from "./yaakUrl";

describe("isYaakUrl", () => {
  test("accepts yaak.app and its subdomains over https", () => {
    expect(isYaakUrl("https://yaak.app")).toBe(true);
    expect(isYaakUrl("https://yaak.app/pricing?intent=x")).toBe(true);
    expect(isYaakUrl("https://docs.yaak.app/plugins")).toBe(true);
    expect(isYaakUrl("https://YAAK.app/dashboard")).toBe(true);
  });

  test("rejects hosts that only start or end like yaak.app", () => {
    expect(isYaakUrl("https://yaak.app.evil.com")).toBe(false);
    expect(isYaakUrl("https://yaak.app.evil.com/pricing")).toBe(false);
    expect(isYaakUrl("https://notyaak.app")).toBe(false);
    expect(isYaakUrl("https://evil.com/?next=https://yaak.app")).toBe(false);
    expect(isYaakUrl("https://yaak.app@evil.com")).toBe(false);
  });

  test("rejects other schemes and things that aren't URLs", () => {
    expect(isYaakUrl("http://yaak.app")).toBe(false);
    expect(isYaakUrl("javascript:alert(1)//yaak.app")).toBe(false);
    expect(isYaakUrl("/docs")).toBe(false);
    expect(isYaakUrl("")).toBe(false);
  });
});
