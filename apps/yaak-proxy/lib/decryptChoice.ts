import { editDecrypts } from "./decrypt";

/** A change to the decrypt list, as `edit_decrypt_list` takes it */
export interface ListEdit {
  add: string[];
  remove: string[];
}

/** A Decrypt or Stop Decrypting chosen somewhere in the app, with what its toast says */
export interface DecryptChoice {
  edit: ListEdit;
  /** "Decrypting www.google.com" */
  message: string;
  /** Under it, when nothing more pressing is */
  sub?: string;
}

/** What applying a choice needs from the app: the certificate's state and the engine */
export interface ChoiceDeps {
  /** The app can trust the certificate itself, as on macOS; elsewhere the entry is written at once */
  canTrust: boolean;
  /** Reads whether the certificate is trusted now */
  readTrusted: () => Promise<boolean>;
  /** macOS's password prompt */
  trust: () => Promise<{ cancelled: boolean; trusted: boolean }>;
  save: (edit: ListEdit) => Promise<{ stillEncrypted: number }>;
}

export type ChoiceResult =
  | { status: "applied"; stillEncrypted: number }
  /** The password prompt was cancelled: nothing changed, and nothing to say */
  | { status: "cancelled" }
  /** The prompt was answered but the certificate is still not trusted */
  | { status: "untrusted" };

/**
 * Trust at the first Decrypt: a change that can make something decrypt first trusts the
 * certificate while it isn't, then writes the change only once that succeeded. A change that
 * only stops decrypting never asks.
 */
export async function applyChoice(deps: ChoiceDeps, edit: ListEdit): Promise<ChoiceResult> {
  if (deps.canTrust && editDecrypts(edit) && !(await deps.readTrusted())) {
    const result = await deps.trust();
    if (result.cancelled) return { status: "cancelled" };
    if (!result.trusted) return { status: "untrusted" };
  }
  const saved = await deps.save(edit);
  return { status: "applied", stillEncrypted: saved.stillEncrypted };
}

/**
 * The entries whose open connections a change can make decryptable, which Reconnect closes and
 * the toast counts: those it added, and exclusions it took off
 */
export function reconnectEntries(edit: ListEdit): string[] {
  return [
    ...edit.add.filter((e) => !e.trim().startsWith("!")),
    ...edit.remove.filter((e) => e.trim().startsWith("!")),
  ];
}

/** The toast after a choice was applied */
export interface ChoiceToast {
  message: string;
  sub: string | null;
  /**
   * The entries Reconnect closes the open connections of, one `reconnect_tunnels` each: those
   * the change added, and exclusions it took off. Empty when nothing open stays encrypted.
   */
  reconnect: string[];
}

/**
 * Says what was chosen, with Undo; when open connections the list now decrypts stay encrypted,
 * how many, with Reconnect for them. Nothing reconnects without that click.
 */
export function choiceToast(choice: DecryptChoice, stillEncrypted: number): ChoiceToast {
  if (stillEncrypted <= 0)
    return { message: choice.message, sub: choice.sub ?? null, reconnect: [] };
  const n = stillEncrypted.toLocaleString();
  const reconnect = reconnectEntries(choice.edit);
  return {
    message: choice.message,
    sub: `${n} open ${stillEncrypted === 1 ? "connection stays" : "connections stay"} encrypted.`,
    reconnect,
  };
}
