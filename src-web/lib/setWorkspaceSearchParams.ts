import { router } from './router.js';

/**
 * Setting search params using "from" on the global router instance in tanstack router does not
 * currently behave very well, so this is a wrapper function that gives a typesafe interface
 * for the same thing.
 */
export function setWorkspaceSearchParams(
  search: Partial<{
    cookie_jar_id: string | null;
    environment_id: string | null;
    request_id: string | null;
  }>,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (router as any).navigate({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    search: (prev: any) => ({ ...prev, ...search }),
  });
}
