/**
 * Ask the browser not to evict this origin's data under storage pressure.
 *
 * Without it IndexedDB — where the worker's SQLite pages live — is "best
 * effort", and a browser clearing space can drop a user's workspaces. Granting
 * is the browser's call; it typically says yes once a site looks installed or
 * engaged, and often says no on localhost. This is a request, not a guarantee,
 * and there is nothing useful to do when it declines.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist == null) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
