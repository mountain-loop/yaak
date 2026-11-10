import { applyFontSizes } from "./lib/interfaceSettings";
import { readSettingsValues, SETTINGS_VALUES_KEY } from "./lib/settings";

// Yaak's default sizes unless changed in Settings' Interface tab, so the two apps read as one
// family.
applyFontSizes(readSettingsValues(localStorage.getItem(SETTINGS_VALUES_KEY)));
