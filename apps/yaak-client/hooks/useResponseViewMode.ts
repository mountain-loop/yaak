import { useLocalStorage } from 'react-use';

const DEFAULT_VIEW_MODE = 'pretty';

export function useResponseViewMode(requestId?: string): [string, (m: 'pretty' | 'raw') => void] {
  const [value, setValue] = useLocalStorage<'pretty' | 'raw'>(`response_view_mode::${requestId}`);
  return [value ?? DEFAULT_VIEW_MODE, setValue];
}
