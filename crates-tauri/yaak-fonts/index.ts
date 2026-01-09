import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { Fonts } from './bindings/gen_fonts';

export async function listFonts() {
  return invoke<Fonts>('plugin:yaak-fonts|list', {});
}

export function useFonts() {
  return useQuery({
    queryKey: ['list_fonts'],
    queryFn: () => listFonts(),
  });
}
