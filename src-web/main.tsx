import './main.css';
import { RouterProvider } from '@tanstack/react-router';
import { type } from '@tauri-apps/plugin-os';
import { changeModelStoreWorkspace, initModelStore } from '@yaakapp-internal/models';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initSync } from './init/sync';
import { initGlobalListeners } from './lib/initGlobalListeners';
import { jotaiStore } from './lib/jotai';
import { router } from './lib/router';

const osType = type();
document.documentElement.setAttribute('data-platform', osType);

window.addEventListener('keydown', (e) => {
  const rx = /input|select|textarea/i;

  const target = e.target;
  if (e.key !== 'Backspace') return;
  if (!(target instanceof Element)) return;
  if (target.getAttribute('contenteditable') !== null) return;

  if (
    !rx.test(target.tagName) ||
    ('disabled' in target && target.disabled) ||
    ('readOnly' in target && target.readOnly)
  ) {
    e.preventDefault();
  }
});

// Initialize a bunch of watchers
initSync();
initModelStore(jotaiStore);
initGlobalListeners();
await changeModelStoreWorkspace(null); // Load global models

console.log('Creating React root');
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
