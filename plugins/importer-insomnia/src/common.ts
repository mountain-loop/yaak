export function isJSObject(obj: unknown) {
  return Object.prototype.toString.call(obj) === '[object Object]';
}

export function isJSString(obj: unknown) {
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

/** Recursively render all nested object properties */
export function convertTemplateSyntax<T>(obj: T): T {
  if (typeof obj === 'string') {
    return obj.replaceAll(/{{\s*(_\.)?([^}]+)\s*}}/g, '${[$2]}') as T;
  } else if (Array.isArray(obj) && obj != null) {
    return obj.map(convertTemplateSyntax) as T;
  } else if (typeof obj === 'object' && obj != null) {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, convertTemplateSyntax(v)]),
    ) as T;
  } else {
    return obj;
  }
}
