import { AnyModel } from '../bindings/gen_models';

export * from '../bindings/gen_models';
export * from '../bindings/gen_util';
export * from './store';
export * from './atoms';

export function modelTypeLabel(m: AnyModel): string {
  const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);
  return m.model.split('_').map(capitalize).join(' ');
}
