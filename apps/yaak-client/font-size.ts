// Listen for settings changes, the re-compute theme
import { platform } from "@yaakapp-internal/platform";
import type { ModelPayload } from "@yaakapp-internal/models";
import { fireAndForget } from "./lib/fireAndForget";
import { getSettings } from "./lib/settings";

function setFontSizeOnDocument(fontSize: number) {
  document.documentElement.style.fontSize = `${fontSize}px`;
}

platform.listen<ModelPayload[]>("model_writes", (payloads) => {
  for (const payload of payloads) {
    if (payload.change.type !== "upsert") continue;
    if (payload.model.model !== "settings") continue;
    setFontSizeOnDocument(payload.model.interfaceFontSize);
  }
});

fireAndForget(getSettings().then((settings) => setFontSizeOnDocument(settings.interfaceFontSize)));
