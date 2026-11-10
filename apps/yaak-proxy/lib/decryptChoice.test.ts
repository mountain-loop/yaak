import { describe, expect, test, vi } from "vite-plus/test";
import { applyChoice, type ChoiceDeps, choiceToast, reconnectEntries } from "./decryptChoice";

function deps(over: Partial<ChoiceDeps> = {}) {
  const calls: string[] = [];
  const d: ChoiceDeps = {
    canTrust: true,
    readTrusted: vi.fn(async () => {
      calls.push("ca_status");
      return false;
    }),
    trust: vi.fn(async () => {
      calls.push("ca_trust");
      return { cancelled: false, trusted: true };
    }),
    save: vi.fn(async () => {
      calls.push("edit_decrypt_list");
      return { stillEncrypted: 2 };
    }),
    ...over,
  };
  return { d, calls };
}

const decrypt = { add: ["host:www.google.com"], remove: [] };

describe("trust at the first Decrypt", () => {
  test("trusts first while untrusted, then writes the change", async () => {
    const { d, calls } = deps();
    expect(await applyChoice(d, decrypt)).toEqual({ status: "applied", stillEncrypted: 2 });
    expect(calls).toEqual(["ca_status", "ca_trust", "edit_decrypt_list"]);
  });

  test("a cancelled prompt writes nothing", async () => {
    const { d, calls } = deps({
      trust: async () => {
        calls.push("ca_trust");
        return { cancelled: true, trusted: false };
      },
    });
    expect(await applyChoice(d, decrypt)).toEqual({ status: "cancelled" });
    expect(calls).toEqual(["ca_status", "ca_trust"]);
  });

  test("a prompt answered without trust writes nothing either", async () => {
    const { d } = deps({ trust: async () => ({ cancelled: false, trusted: false }) });
    expect(await applyChoice(d, decrypt)).toEqual({ status: "untrusted" });
    expect(d.save).not.toHaveBeenCalled();
  });

  test("a failed prompt fails the choice, nothing written", async () => {
    const { d } = deps({
      trust: async () => {
        throw new Error("Not supported");
      },
    });
    await expect(applyChoice(d, decrypt)).rejects.toThrow("Not supported");
    expect(d.save).not.toHaveBeenCalled();
  });

  test("asks nothing once trusted", async () => {
    const { d, calls } = deps({
      readTrusted: async () => {
        calls.push("ca_status");
        return true;
      },
    });
    await applyChoice(d, decrypt);
    expect(calls).toEqual(["ca_status", "edit_decrypt_list"]);
  });

  test("stopping never asks, and dropping an exclusion does", async () => {
    const stop = deps();
    await applyChoice(stop.d, { add: ["!app:Dia"], remove: ["host:www.google.com"] });
    expect(stop.calls).toEqual(["edit_decrypt_list"]);

    const unexclude = deps();
    await applyChoice(unexclude.d, { add: [], remove: ["!host:*.chase.com"] });
    expect(unexclude.calls).toEqual(["ca_status", "ca_trust", "edit_decrypt_list"]);
  });

  test("where the app can't trust the certificate itself, the entry is written at once", async () => {
    const { d, calls } = deps({ canTrust: false });
    await applyChoice(d, decrypt);
    expect(calls).toEqual(["edit_decrypt_list"]);
  });
});

describe("the toast after a choice", () => {
  const choice = { edit: decrypt, message: "Decrypting www.google.com" };

  test("says what was chosen, and nothing to reconnect when nothing open stays encrypted", () => {
    expect(choiceToast(choice, 0)).toEqual({
      message: "Decrypting www.google.com",
      sub: null,
      reconnect: [],
    });
    expect(
      choiceToast(
        { edit: { add: ["*"], remove: [] }, message: "Decrypting everything", sub: "Except" },
        0,
      ).sub,
    ).toBe("Except");
  });

  test("offers Reconnect for the entry when open connections stay encrypted", () => {
    expect(choiceToast(choice, 3)).toEqual({
      message: "Decrypting www.google.com",
      sub: "3 open connections stay encrypted",
      reconnect: ["host:www.google.com"],
    });
    expect(choiceToast(choice, 1).sub).toBe("1 open connection stays encrypted");
  });

  test("Reconnect for an exclusion taken off names the exclusion, as the engine reads it", () => {
    const stopExcluding = { edit: { add: [], remove: ["!host:*.chase.com"] }, message: "x" };
    expect(choiceToast(stopExcluding, 1).reconnect).toEqual(["!host:*.chase.com"]);
  });
});

describe("what Reconnect covers", () => {
  test("the entries a change added, and the exclusions it took off, never what it stopped", () => {
    expect(
      reconnectEntries({ add: ["host:a.com", "!app:Dia"], remove: ["!host:*.b.com", "app:Slack"] }),
    ).toEqual(["host:a.com", "!host:*.b.com"]);
  });
});
