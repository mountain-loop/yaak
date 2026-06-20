const bareFieldValue = /^[A-Za-z0-9_./][A-Za-z0-9_\-./]*$/;
const operatorWord = /^(?:AND|OR|NOT)$/i;

export function formatFieldFilter(field: string, value: string) {
  const escapedValue = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const filterValue =
    bareFieldValue.test(value) && !operatorWord.test(value) ? value : `"${escapedValue}"`;
  return `@${field}:${filterValue}`;
}
