// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export function debounce(fn: (...args: any[]) => void, delay = 500) {
  let timer: ReturnType<typeof setTimeout>;
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  const result = (...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  result.cancel = () => {
    clearTimeout(timer);
  };
  return result;
}
