import type { GitRemote } from "@yaakapp-internal/git";
import { gitMutations } from "@yaakapp-internal/git";
import { showPromptForm } from "../../lib/prompt-form";
import { gitCallbacks } from "./callbacks";

export async function addGitRemote(dir: string, defaultName?: string): Promise<GitRemote> {
  const r = await showPromptForm({
    id: "add-remote",
    title: "Добавить remote",
    inputs: [
      { type: "text", label: "Название", name: "name", defaultValue: defaultName },
      { type: "text", label: "URL", name: "url" },
    ],
  });
  if (r == null) throw new Error("Отменён диалог remote");

  const name = String(r.name ?? "");
  const url = String(r.url ?? "");
  return gitMutations(dir, gitCallbacks(dir)).addRemote.mutateAsync({ name, url });
}
