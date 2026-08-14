// Listen for settings changes, the re-compute theme
import { platform } from "@yaakapp-internal/platform";
import type { ModelPayload, Settings } from "@yaakapp-internal/models";
import { fireAndForget } from "./lib/fireAndForget";
import { getSettings } from "./lib/settings";

function setFonts(settings: Settings) {
  document.documentElement.style.setProperty("--font-family-editor", settings.editorFont ?? "");
  document.documentElement.style.setProperty(
    "--font-family-interface",
    settings.interfaceFont ?? "",
  );
}

platform.listen<ModelPayload[]>("model_writes", (payloads) => {
  for (const payload of payloads) {
    if (payload.change.type !== "upsert") continue;
    if (payload.model.model !== "settings") continue;
    setFonts(payload.model);
  }
});

fireAndForget(getSettings().then((settings) => setFonts(settings)));
