import { hotkeyActions } from '../hooks/useHotKey';
import { HotkeyList } from './core/HotkeyList';

export function KeyboardShortcutsDialog() {
  return (
    <div className="grid h-full">
      <HotkeyList hotkeys={hotkeyActions} className="pb-6" />
    </div>
  );
}
