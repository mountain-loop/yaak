import type { CapabilityName } from "../types";

/**
 * What this host says when it is asked for something it doesn't have.
 *
 * A rejected command reaches the user as a toast built from `message`, so the
 * message is the user-facing text and has to read like one. The structured
 * fields alongside it are for code: `capability` names the switch a caller
 * should have checked first, and `cmd` identifies the command without anyone
 * having to parse prose back out of the message.
 */
export class UnsupportedCommandError extends Error {
  readonly name = "UnsupportedCommandError";
  /** Stable discriminator, so a caller can branch without matching on text. */
  readonly code = "unsupported_command";
  readonly cmd: string;
  readonly capability: CapabilityName | null;

  constructor(cmd: string, message: string, capability: CapabilityName | null = null) {
    super(message);
    this.cmd = cmd;
    this.capability = capability;
  }
}

export function unsupported(
  cmd: string,
  reason: string,
  capability: CapabilityName | null = null,
): UnsupportedCommandError {
  return new UnsupportedCommandError(cmd, reason, capability);
}
