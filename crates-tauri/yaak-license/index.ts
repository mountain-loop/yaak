import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { platform } from "@yaakapp-internal/platform";
import { appInfo } from "@yaakapp/yaak-client/lib/appInfo";
import { useEffect } from "react";
import { LicenseCheckStatus } from "./bindings/license";

export * from "./bindings/license";

const CHECK_QUERY_KEY = ["license.check"];

export async function checkLicense(): Promise<LicenseCheckStatus> {
  return platform.rpc<LicenseCheckStatus>("plugin:yaak-license|check");
}

export function useLicense() {
  const queryClient = useQueryClient();
  const activate = useMutation<void, string, { licenseKey: string }>({
    mutationKey: ["license.activate"],
    mutationFn: (payload) => platform.rpc("plugin:yaak-license|activate", payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHECK_QUERY_KEY }),
  });

  const deactivate = useMutation<void, string, void>({
    mutationKey: ["license.deactivate"],
    mutationFn: () => platform.rpc("plugin:yaak-license|deactivate"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHECK_QUERY_KEY }),
  });

  // Check the license again after a license is activated
  useEffect(() => {
    return platform.listen("license-activated", () => {
      void queryClient.invalidateQueries({ queryKey: CHECK_QUERY_KEY });
    });
  }, []);

  const check = useQuery<LicenseCheckStatus | null, string>({
    refetchInterval: 1000 * 60 * 60 * 12, // Refetch every 12 hours
    refetchOnWindowFocus: false,
    queryKey: CHECK_QUERY_KEY,
    queryFn: async () => {
      if (!appInfo.featureLicense) {
        return null;
      }
      return checkLicense();
    },
  });

  return {
    activate,
    deactivate,
    check,
  } as const;
}
