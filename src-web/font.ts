// Listen for settings changes, the re-compute theme
import { listen } from '@tauri-apps/api/event';
import type { ModelPayload, Settings } from '@yaakapp-internal/models';
import { getSettings } from './lib/settings';

function setFonts(settings: Settings) {
  document.documentElement.style.setProperty('--font-family-editor', settings.editorFont ?? '');
  document.documentElement.style.setProperty(
    '--font-family-interface',
    settings.interfaceFont ?? '',
  );
}

listen<ModelPayload>('upserted_model', async (event) => {
  if (event.payload.model.model !== 'settings') return;
  setFonts(event.payload.model);
}).catch(console.error);

getSettings().then((settings) => setFonts(settings));
