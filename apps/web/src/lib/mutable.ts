/** Drops readonly so generated parameter objects can be bound in the UI. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] }
