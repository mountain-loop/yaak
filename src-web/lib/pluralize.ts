export function pluralize(word: string, count: number): string {
  if (count === 1) {
    return word;
  }
  return `${word}s`;
}

export function pluralizeCount(
  word: string,
  count: number,
  opt: { omitSingle?: boolean; noneWord?: string } = {},
): string {
  if (opt.omitSingle && count === 1) {
    return word;
  }
  if (opt.noneWord && count === 0) {
    return opt.noneWord;
  }
  return `${count} ${pluralize(word, count)}`;
}
