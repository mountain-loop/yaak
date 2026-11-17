import type { ProxyLock } from "@yaakapp-internal/proxy-lib";

/** What every refused read starts with, before its reason */
const LOCKED_PREFIX = "Traffic is locked: ";

/** Where each platform keeps the key, by the name its users know it by */
function keyStoreName(os: string): string {
  switch (os) {
    case "macos":
      return "Keychain Access";
    case "windows":
      return "Credential Manager";
    default:
      return "your keyring";
  }
}

/**
 * The locked state's one line: how to let Yaak Proxy read its key when the key store is what
 * refused, or else the reason itself, without the "Traffic is locked" its title already says.
 */
export function lockedLine(lock: ProxyLock, os: string): string {
  if (lock.keychain) {
    return `Allow Yaak Proxy to use its key in ${keyStoreName(os)}, then retry.`;
  }
  const reason = lock.message.startsWith(LOCKED_PREFIX)
    ? lock.message.slice(LOCKED_PREFIX.length)
    : lock.message;
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}
