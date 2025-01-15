import { clear, readText } from '@tauri-apps/plugin-clipboard-manager';
import { motion } from 'framer-motion';
import React, { useEffect, useState } from 'react';
import { useImportCurl } from '../hooks/useImportCurl';
import { useWindowFocus } from '../hooks/useWindowFocus';
import { Button } from './core/Button';
import { Icon } from './core/Icon';

export function ImportCurlButton() {
  const focused = useWindowFocus();
  const [clipboardText, setClipboardText] = useState('');

  const importCurl = useImportCurl();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    readText().then(setClipboardText);
  }, [focused]);

  if (!clipboardText?.trim().startsWith('curl ')) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.5 }}
    >
      <Button
        size="2xs"
        variant="border"
        color="success"
        className="rounded-full"
        leftSlot={<Icon icon="paste" size="sm" />}
        isLoading={isLoading}
        onClick={async () => {
          setIsLoading(true);
          try {
            await importCurl.mutateAsync({ command: clipboardText });
            await clear(); // Clear the clipboard so the button goes away
            setClipboardText('');
          } catch (e) {
            console.log('Failed to import curl', e);
          } finally {
            setIsLoading(false);
          }
        }}
      >
        Import Curl
      </Button>
    </motion.div>
  );
}
