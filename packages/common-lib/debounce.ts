// oxlint-disable-next-line no-explicit-any
export function debounce(fn: (...args: any[]) => void, delay = 500) {
  let timer: ReturnType<typeof setTimeout>;
  // oxlint-disable-next-line no-explicit-any
  const result = (...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  result.cancel = () => {
    clearTimeout(timer);
  };
  return result;
}
