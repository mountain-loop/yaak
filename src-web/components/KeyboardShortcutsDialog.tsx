import { hotkeyActions } from '../hooks/useHotKey';
import { HotKeyList } from './core/HotKeyList';

export function KeyboardShortcutsDialog() {
  return (
    <div className="grid h-full">
      <HotKeyList hotkeys={hotkeyActions} className="pb-6" />
    </div>
  );
}
