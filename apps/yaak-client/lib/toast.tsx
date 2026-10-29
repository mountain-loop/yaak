// The toast store alone, without the components, which tests in a plain runtime can't load
import {
  hideToast as hideToastIn,
  hideToastById as hideToastByIdIn,
  type ShowToastArgs,
  showToast as showToastIn,
  type ToastInstance,
} from "@yaakapp-internal/ui/toast";
import { jotaiStore } from "./jotai";

export { toastsAtom } from "@yaakapp-internal/ui/toast";

export function showToast(args: ShowToastArgs) {
  return showToastIn(jotaiStore, args);
}

export function hideToastById(id: string) {
  hideToastByIdIn(jotaiStore, id);
}

export function hideToast(toHide: ToastInstance) {
  hideToastIn(jotaiStore, toHide);
}

export function showErrorToast<T>({
  id,
  title,
  message,
}: {
  id: string;
  title: string;
  message: T;
}) {
  return showToast({
    id,
    color: "danger",
    timeout: null,
    message: (
      <div className="w-full">
        <h2 className="text-lg font-bold mb-2">{title}</h2>
        <div className="whitespace-pre-wrap wrap-break-word">{String(message)}</div>
      </div>
    ),
  });
}
