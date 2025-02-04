import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { ModelPayload, Settings } from '@yaakapp-internal/models';
import { invokeCmd } from './lib/tauri';
import type { Appearance } from './lib/theme/appearance';
import { getCSSAppearance, subscribeToPreferredAppearance } from './lib/theme/appearance';
import { getResolvedTheme } from './lib/theme/themes';
import type { YaakTheme } from './lib/theme/window';
import { addThemeStylesToDocument, setThemeOnDocument } from './lib/theme/window';

// NOTE: CSS appearance isn't as accurate as getting it async from the window (next step), but we want
//  a good appearance guess so we're not waiting too long
let preferredAppearance: Appearance = getCSSAppearance();
subscribeToPreferredAppearance(async (a) => {
  preferredAppearance = a;
  await configureTheme();
});

configureTheme().then(
  async () => {
    // To prevent theme flashing, the backend hides new windows by default, so we
    // need to show it here, after configuring the theme for the first time.
    await getCurrentWebviewWindow().show();
  },
  (err) => console.log('Failed to configure theme', err),
);

// Listen for settings changes, the re-compute theme
listen<ModelPayload>('upserted_model', async (event) => {
  if (event.payload.model.model !== 'settings') return;
  await configureTheme();
}).catch(console.error);

async function configureTheme() {
  const settings = await invokeCmd<Settings>('cmd_get_settings');
  const theme = getResolvedTheme(
    preferredAppearance,
    settings.appearance,
    settings.themeLight,
    settings.themeDark,
  );
  addThemeStylesToDocument(theme.active);
  setThemeOnDocument(theme.active);
  emitBgChange(theme.active);
}

function emitBgChange(t: YaakTheme) {
  if (t.surface == null) return;
  emit('yaak_bg_changed', t.surface.hexNoAlpha()).catch(console.error);
}
