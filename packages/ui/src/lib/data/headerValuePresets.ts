/**
 * A suggested value for a header. A plain string is used when the displayed
 * label and the inserted value are the same (e.g. mime types). The object form
 * lets us show a short, readable `label` (e.g. "Chrome (Windows)") while
 * inserting a longer `value` (the full User-Agent string).
 */
export type HeaderValuePreset = string | { label: string; value: string };
