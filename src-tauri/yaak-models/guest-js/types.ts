export type ExtractModel<T, M> = T extends { model: M } ? T : never;
export type ExtractModels<T, M extends T[keyof T]> = T extends { model: M } ? T : never;
