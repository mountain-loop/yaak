import { Toasts as BaseToasts } from "@yaakapp-internal/ui";
import { showErrorDialog } from "./ErrorBoundary";

export type { ToastInstance } from "@yaakapp-internal/ui";

export const Toasts = () => <BaseToasts onShowError={showErrorDialog} />;
