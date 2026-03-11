export async function minPromiseMillis<T>(promise: Promise<T>, millis = 300): Promise<T> {
  const start = Date.now();
  let result: T;

  try {
    result = await promise;
  } catch (e) {
    const remaining = millis - (Date.now() - start);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    throw e;
  }

  const remaining = millis - (Date.now() - start);
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
  return result;
}
