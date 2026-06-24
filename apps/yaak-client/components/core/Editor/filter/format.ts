const bareFieldValue = /^[^\s"]\S*$/;

export function formatFieldFilter(field: string, value: string) {
  const escapedValue = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const filterValue = bareFieldValue.test(value) ? value : `"${escapedValue}"`;
  return `@${field}:${filterValue}`;
}
