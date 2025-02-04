export type AtLeast<T, K extends keyof T> = Partial<T> & Pick<T, K>;
export type MaybePromise<T> = Promise<T> | T;
