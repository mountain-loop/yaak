export type ExtractModel<T, M> = T extends { model: M } ? T : never;
