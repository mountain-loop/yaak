import React from 'react';
import { IconTooltip } from './core/IconTooltip';

export function EnvironmentSharableTooltip() {
  return (
    <IconTooltip
      content={
        <>
          Sharable environments are included in Directory Sync and data export. It is recommended
          to encrypt all variable values within sharable environments to prevent accidentally
          leaking secrets.
        </>
      }
    />
  );
}
