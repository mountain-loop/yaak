
export function convertSyntax(variable: string): string {
  if (!isJSString(variable)) return variable;
  return variable.replaceAll(/{{\s*(_\.)?([^}]+)\s*}}/g, '${[$2]}');
}

export function isJSObject(obj: any) {
  return Object.prototype.toString.call(obj) === '[object Object]';
}

export function isJSString(obj: any) {
  return Object.prototype.toString.call(obj) === '[object String]';
}

export function convertId(id: string): string {
  if (id.startsWith('GENERATE_ID::')) {
    return id;
  }
  return `GENERATE_ID::${id}`;
}

export function deleteUndefinedAttrs<T>(obj: T): T {
  if (Array.isArray(obj) && obj != null) {
    return obj.map(deleteUndefinedAttrs) as T;
  } else if (typeof obj === 'object' && obj != null) {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, deleteUndefinedAttrs(v)]),
    ) as T;
  } else {
    return obj;
  }
}
