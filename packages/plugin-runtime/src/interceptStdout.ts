import process from 'node:process';

export function interceptStdout(intercept: (text: string) => string) {
  const old_stdout_write = process.stdout.write;
  const old_stderr_write = process.stderr.write;

  process.stdout.write = ((write) =>
    ((text: string, ...args: never[]) => {
      write.call(process.stdout, interceptor(text, intercept), ...args);
      return true;
    }) as typeof process.stdout.write)(process.stdout.write);

  process.stderr.write = ((write) =>
    ((text: string, ...args: never[]) => {
      write.call(process.stderr, interceptor(text, intercept), ...args);
      return true;
    }) as typeof process.stderr.write)(process.stderr.write);

  // puts back to original
  return function unhook() {
    process.stdout.write = old_stdout_write;
    process.stderr.write = old_stderr_write;
  };
}

function interceptor(text: string, fn: (text: string) => string) {
  return fn(text).replace(/\n$/, '') + (fn(text) && /\n$/.test(text) ? '\n' : '');
}
