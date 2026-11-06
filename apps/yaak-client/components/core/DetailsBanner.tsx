import {
  DetailsBanner as BaseDetailsBanner,
  type DetailsBannerProps,
  type StoredValue,
} from "@yaakapp-internal/ui";
import { atom, useAtom, type WritableAtom } from "jotai";
import { type SetStateAction, useMemo } from "react";
import { atomWithKVStorage } from "../../lib/atoms/atomWithKVStorage";

export function DetailsBanner(props: Omit<DetailsBannerProps, "useStoredValue">) {
  return <BaseDetailsBanner {...props} useStoredValue={useDetailsBannerStoredValue} />;
}

export function useDetailsBannerStoredValue<T extends StoredValue>(
  key: string | string[] | null,
  fallback: T,
) {
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- We only want to recompute the atom when the key changes
  const valueAtom = useMemo<WritableAtom<T, [SetStateAction<T>], void>>(
    () =>
      key != null
        ? atomWithKVStorage<T>(["details_banner", ...[key].flat()], fallback)
        : atom(fallback),
    [key],
  );
  return useAtom(valueAtom);
}
