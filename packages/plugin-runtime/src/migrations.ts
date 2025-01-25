import {HttpRequestAction, TemplateFunction} from '@yaakapp/api';

export function migrateTemplateFunctionSelectOptions(f: TemplateFunction): TemplateFunction {
  const migratedArgs = f.args.map((a) => {
    if (a.type === 'select') {
      a.options = a.options.map((o) => ({
        ...o,
        label: o.label || (o as any).name,
      }));
    }
    return a;
  });

  return {
    ...f,
    args: migratedArgs,
  };
}

export function migrateHttpRequestActionKey(a: HttpRequestAction): HttpRequestAction {
  return  {
    ...a,
    name: a.name || (a as any).key,
  }
}
