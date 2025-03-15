import { Banner } from '../core/Banner';

export function SettingsLicense() {
  return (
    <div className="flex flex-col gap-6 max-w-lg">
        <Banner color="success">
          <strong>License active!</strong> Enjoy using Yaak fork for whatever use.
        </Banner>
    </div>
  );
}
