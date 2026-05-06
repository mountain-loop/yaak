import type { Context } from "@yaakapp/api";
import { describe, expect, it, vi } from "vite-plus/test";
import { plugin } from "../src";

describe("cookie.value", () => {
  const valueFunction = plugin.templateFunctions?.find((f) => f.name === "cookie.value");

  it("should exist", () => {
    expect(valueFunction).toBeDefined();
  });

  it("should get a cookie by name", async () => {
    const getValue = vi.fn().mockResolvedValue("token");

    const result = await valueFunction?.onRender(
      { cookies: { getValue } } as unknown as Context,
      {
        values: {
          name: "co-auth",
        },
        purpose: "send",
      },
    );

    expect(result).toBe("token");
    expect(getValue).toHaveBeenCalledWith({ name: "co-auth" });
  });

  it("should get a cookie by name and domain", async () => {
    const getValue = vi.fn().mockResolvedValue("token");

    const result = await valueFunction?.onRender(
      { cookies: { getValue } } as unknown as Context,
      {
        values: {
          name: "co-auth",
          domain: " example.com ",
        },
        purpose: "send",
      },
    );

    expect(result).toBe("token");
    expect(getValue).toHaveBeenCalledWith({ name: "co-auth", domain: "example.com" });
  });

  it("should support the legacy cookie_name arg", async () => {
    const getValue = vi.fn().mockResolvedValue("token");

    await valueFunction?.onRender(
      { cookies: { getValue } } as unknown as Context,
      {
        values: {
          cookie_name: "co-auth",
        },
        purpose: "send",
      },
    );

    expect(getValue).toHaveBeenCalledWith({ name: "co-auth" });
  });
});
