import classNames from "classnames";
import { useEffect, useState } from "react";
import { rpc } from "../lib/rpc";

/**
 * Icons by app path, as data URLs once loaded, for the whole session. Plain rather than a query
 * per icon, since every new row in the list shows one.
 */
const icons = new Map<string, string | null>();
const loading = new Map<string, Promise<string | null>>();

function loadIcon(path: string): Promise<string | null> {
  let promise = loading.get(path);
  if (promise == null) {
    promise = rpc("app_icon", { path })
      .then((png) => (png == null ? null : `data:image/png;base64,${png}`))
      .catch(() => null)
      .then((url) => {
        icons.set(path, url);
        return url;
      });
    loading.set(path, promise);
  }
  return promise;
}

/** An app's icon, read once per path for the whole session */
export function AppIcon({ path, className }: { path: string; className?: string }) {
  const [url, setUrl] = useState(() => icons.get(path));
  useEffect(() => {
    if (icons.has(path)) {
      setUrl(icons.get(path));
      return;
    }
    let current = true;
    void loadIcon(path).then((loaded) => {
      if (current) setUrl(loaded);
    });
    return () => {
      current = false;
    };
  }, [path]);

  return url == null ? (
    <span aria-hidden className={classNames(className, "inline-block w-4 h-4 shrink-0")} />
  ) : (
    <img alt="" src={url} className={classNames(className, "w-4 h-4 shrink-0")} />
  );
}
