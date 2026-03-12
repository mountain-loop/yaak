import { useRef } from 'react';

const PORTAL_CONTAINER_ID = 'react-portal';

export function usePortal(name: string) {
  const ref = useRef(getOrCreatePortal(name));
  return ref.current;
}

function getOrCreatePortal(name: string) {
  let portalContainer = document.getElementById(PORTAL_CONTAINER_ID);
  if (!portalContainer) {
    portalContainer = document.createElement('div');
    portalContainer.id = PORTAL_CONTAINER_ID;
    document.body.appendChild(portalContainer);
  }

  let existing = portalContainer.querySelector(`:scope > [data-portal-name="${name}"]`);
  if (!existing) {
    const el = document.createElement('div');
    el.setAttribute('data-portal-name', name);
    portalContainer.appendChild(el);
    existing = el;
  }
  return existing;
}
