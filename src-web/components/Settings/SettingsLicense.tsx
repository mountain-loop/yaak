import { useState } from 'react';
import { useLicenseConfirmation } from '../../hooks/useLicenseConfirmation';
import { useToggle } from '../../hooks/useToggle';
import { Banner } from '../core/Banner';

export function SettingsLicense() {
  const [key, setKey] = useState<string>('');
  const [activateFormVisible, toggleActivateFormVisible] = useToggle(false);
  const [licenseDetails, setLicenseDetails] = useLicenseConfirmation();
  const [checked, setChecked] = useState<boolean>(false);

  return (
    <div className="flex flex-col gap-6 max-w-lg">
        <Banner color="success">
          <strong>License active!</strong> Enjoy using Yaak fork for whatever use.
        </Banner>
    </div>
  );
}
