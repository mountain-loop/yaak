import { createContext } from 'react';
import type { DialogState } from './Dialogs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DialogContext = createContext<DialogState>({} as DialogState);
