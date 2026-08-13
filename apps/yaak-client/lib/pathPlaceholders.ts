import type { HttpUrlParameter } from "@yaakapp-internal/models";
import type { EditablePair } from "../components/core/PairEditor";

/**
 * Extract `:name`-style path placeholders from a URL string.
 *
 * A placeholder is `:` followed by one-or-more characters that are not `/`, `?`,
 * `#`, or `:`. The `:` boundary means a placeholder ends where a literal colon
 * starts in the same segment, e.g. `/tasks/:id:increment-importance` yields one
 * placeholder `:id` and `:increment-importance` is literal text.
 *
 * Only `:` that sits at the start of a `/`-delimited segment counts — `/abc:def`
 * has no placeholders. Returned names include the leading colon.
 */
export function extractPathPlaceholders(url: string): string[] {
  return Array.from(url.matchAll(/\/(:[^/?#:]+)/g)).map((m) => m[1] ?? "");
}

/**
 * Build the rows for the Params tab: the request's URL parameters, plus a row for each path
 * placeholder in the URL that doesn't have one yet. A placeholder that appears more than once
 * in the URL still gets a single row.
 *
 * Only placeholder rows get a `commitName`, which makes the editor hold name edits until blur and
 * hand them to `renamePlaceholder` instead of writing on every keystroke — renaming has to rewrite
 * the URL too. `renamePlaceholder` returns false to reject the new name, which reverts the field.
 *
 * `urlParametersKey` changes whenever the URL's placeholders do, and is used to reset the pair
 * editor so derived rows appear and disappear along with the URL.
 */
export function derivePathPlaceholderPairs(
  url: string,
  urlParameters: HttpUrlParameter[],
  renamePlaceholder: (oldName: string, newName: string) => boolean,
): { urlParameterPairs: EditablePair[]; urlParametersKey: string } {
  const placeholderNames = extractPathPlaceholders(url);
  const commitNameFor = (oldName: string) => (newName: string) =>
    renamePlaceholder(oldName, newName);

  // NOTE: Copy each parameter because `commitName` is UI-only. Adding it in place would mutate the
  //  persisted model.
  const urlParameterPairs: EditablePair[] = urlParameters
    .filter((p) => p.name || p.value)
    .map((p) =>
      placeholderNames.includes(p.name) ? { ...p, commitName: commitNameFor(p.name) } : { ...p },
    );

  // NOTE: Ids are derived from the placeholder's position instead of generated, so neither
  //  re-deriving nor renaming hands a row a new identity. The pair editor keys rows by id, so a
  //  changed id remounts the row and drops the user's focus.
  //
  //  A derived id sticks to the parameter once the user gives the row a value, so a parameter that
  //  outlives its placeholder (renamed away in the URL bar) still holds one. Skip past taken ids
  //  so a new placeholder at that position can't collide with it.
  const takenIds = new Set(urlParameterPairs.map((p) => p.id));
  const uniquePlaceholderNames = [...new Set(placeholderNames)];
  for (const [index, name] of uniquePlaceholderNames.entries()) {
    if (urlParameterPairs.some((p) => p.name === name)) continue;

    let id = `path-placeholder:${index}`;
    for (let bump = index + 1; takenIds.has(id); bump++) id = `path-placeholder:${bump}`;
    takenIds.add(id);

    urlParameterPairs.push({ name, value: "", enabled: true, commitName: commitNameFor(name), id });
  }

  return { urlParameterPairs, urlParametersKey: placeholderNames.join(",") };
}

/**
 * Compute the patch for renaming a path placeholder: every occurrence replaced in the URL, and
 * the matching URL parameter renamed so the user's value follows along. Both have to be applied
 * together, or the value detaches from the placeholder.
 *
 * Returns `null` when the rename can't be applied, meaning the caller should leave the model
 * alone. That's the case when the new name wouldn't parse as a placeholder anymore (empty, or
 * containing `/`, `?`, `#`, `:`, or whitespace) or when it's already used by another placeholder
 * in the URL. A missing leading `:` is added rather than rejected, since focusing the name field
 * selects all of its text and typing over it is the natural way to rename.
 */
export function renamePathPlaceholder(
  model: { url: string; urlParameters: HttpUrlParameter[] },
  oldName: string,
  newName: string,
): { url: string; urlParameters: HttpUrlParameter[] } | null {
  const name = newName.startsWith(":") ? newName : `:${newName}`;
  if (!/^:[^/?#:\s]+$/.test(name)) return null;

  const placeholderNames = extractPathPlaceholders(model.url);
  if (!placeholderNames.includes(oldName)) return null;
  if (name !== oldName && placeholderNames.includes(name)) return null;

  const pattern = new RegExp(`(/)${escapeRegExp(oldName)}(?=[/?#:]|$)`, "g");
  return {
    url: model.url.replace(pattern, (_match, slash: string) => `${slash}${name}`),
    urlParameters: model.urlParameters.map((p) => (p.name === oldName ? { ...p, name } : p)),
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
