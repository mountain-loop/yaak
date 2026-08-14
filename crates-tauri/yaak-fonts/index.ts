import { useQuery } from "@tanstack/react-query";
import { platform } from "@yaakapp-internal/platform";
import { Fonts } from "./bindings/gen_fonts";

export async function listFonts() {
  return platform.rpc<Fonts>("plugin:yaak-fonts|list", {});
}

export function useFonts() {
  return useQuery({
    queryKey: ["list_fonts"],
    queryFn: () => listFonts(),
  });
}
