import process from "node:process";

export function interceptStdout(
  intercept: (text: string) => string,
) {
  const old_stdout_write = process.stdout.write;
  const old_stderr_write = process.stderr.write;

  process.stdout.write = (function (write) {
    return function (text: string) {
      arguments[0] = interceptor(text, intercept);
      // deno-lint-ignore no-explicit-any
      write.apply(process.stdout, arguments as any);
      return true;
    };
  })(process.stdout.write);

  process.stderr.write = (function (write) {
    return function (text: string) {
      arguments[0] = interceptor(text, intercept);
      // deno-lint-ignore no-explicit-any
      write.apply(process.stderr, arguments as any);
      return true;
    };
  })(process.stderr.write);

  // puts back to original
  return function unhook() {
    process.stdout.write = old_stdout_write;
    process.stderr.write = old_stderr_write;
  };
}

function interceptor(text: string, fn: (text: string) => string) {
  return fn(text).replace(/\n$/, "") +
    (fn(text) && /\n$/.test(text) ? "\n" : "");
}
