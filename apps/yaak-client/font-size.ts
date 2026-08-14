// Listen for settings changes, the re-compute theme
import { listen } from "@tauri-apps/api/event";
import type { ModelPayload } from "@yaakapp-internal/models";
import { fireAndForget } from "./lib/fireAndForget";
import { getSettings } from "./lib/settings";

function setFontSizeOnDocument(fontSize: number) {
  document.documentElement.style.fontSize = `${fontSize}px`;
}

listen<ModelPayload[]>("model_writes", async (event) => {
  for (const payload of event.payload) {
    if (payload.change.type !== "upsert") continue;
    if (payload.model.model !== "settings") continue;
    setFontSizeOnDocument(payload.model.interfaceFontSize);
  }
}).catch(console.error);

fireAndForget(getSettings().then((settings) => setFontSizeOnDocument(settings.interfaceFontSize)));
