export function truncate(text: string, len: number): string {
  if (text.length <= len) return text;
  return `${text.slice(0, len)}…`;
}
