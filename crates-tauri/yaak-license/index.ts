import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { platform } from "@yaakapp-internal/platform";
import type { LicenseCheckStatus } from "./bindings/license";

export * from "./bindings/license";

const CHECK_QUERY_KEY = ["license.check"];

// Calls the Rust side so the activation row gets written to the DB, but never
// lets a failure (missing plugin, feature off, etc.) affect the UI.
async function pokeRust(command: string, payload?: Record<string, unknown>): Promise<void> {
  try {
    await platform.rpc(`plugin:yaak-license|${command}`, payload);
  } catch (e) {
    console.warn(`license ${command} (ignored):`, e);
  }
}

// Mock: always report an active license ten years out. The Rust check is
// called first only so it can seed the activation id in the DB.
export async function checkLicense(): Promise<LicenseCheckStatus> {
  await pokeRust("check");
  const periodEnd = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3650).toISOString();
  return {
    status: "active",
    data: { periodEnd, cancelAt: null },
  } as LicenseCheckStatus;
}

export function useLicense() {
  const queryClient = useQueryClient();

  // Mock: accepts any key; Rust records an activation id in the DB
  const activate = useMutation<void, string, { licenseKey: string }>({
    mutationKey: ["license.activate"],
    mutationFn: (payload) => pokeRust("activate", payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHECK_QUERY_KEY }),
  });

  // Mock: Rust deletes the activation id (the next check re-seeds it)
  const deactivate = useMutation<void, string, void>({
    mutationKey: ["license.deactivate"],
    mutationFn: () => pokeRust("deactivate"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHECK_QUERY_KEY }),
  });

  const check = useQuery<LicenseCheckStatus | null, string>({
    refetchOnWindowFocus: false,
    staleTime: Infinity,
    queryKey: CHECK_QUERY_KEY,
    queryFn: checkLicense,
  });

  return {
    activate,
    deactivate,
    check,
  } as const;
}
