/**
 * Utility type to make some properties of an object required.
 */
export type WithRequired<T, K extends keyof T> = T & {
	[P in K]-?: NonNullable<T[P]>;
};
