import { SettingsLicense as SharedSettingsLicense } from "@yaakapp-internal/ui";
import { useSettingsView } from "../../hooks/useSettingsView";
import { CargoFeature } from "../CargoFeature";

export function SettingsLicense() {
  return (
    <CargoFeature feature="license">
      <SettingsLicenseCmp />
    </CargoFeature>
  );
}

function SettingsLicenseCmp() {
  const bound = useSettingsView();
  if (bound == null) return null;
  return <SharedSettingsLicense view={bound.view} callbacks={bound.callbacks} />;
}
