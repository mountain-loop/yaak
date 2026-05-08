import type { GitWorktreeStatus, GitWorktreeStatusEntry } from "@yaakapp-internal/git";
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { selectAtom } from "jotai/utils";

export const gitWorktreeStatusAtom = atom<GitWorktreeStatus | null>(null);

export const gitWorktreeStatusByModelIdAtom = atom<Record<string, GitWorktreeStatusEntry>>({});

export const gitWorktreeStatusFamily = atomFamily(
  (modelId: string) =>
    selectAtom(
      gitWorktreeStatusByModelIdAtom,
      (statusByModelId) => statusByModelId[modelId] ?? null,
      (a, b) =>
        a?.relaPath === b?.relaPath &&
        a?.status === b?.status &&
        a?.staged === b?.staged &&
        a?.modelId === b?.modelId,
  ),
  Object.is,
);
