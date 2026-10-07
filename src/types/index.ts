import type { WithRequired } from "@/types/utils";

/** What a query parameter may carry before it is serialized into the URL */
export type QueryValue = string | number | bigint | boolean;

export type Data = {
	body?: Record<string, unknown>;
	path?: Record<string, string>;
	query?: Record<string, QueryValue>;
	url: string;
};

export type DataUrl<D extends Pick<Data, "url">> = D["url"];

type OmitIfEmpty<T> = keyof T extends never ? never : T;

type ClientPath<D extends Data> =
	NonNullable<D["path"]> extends infer P extends object
		? OmitIfEmpty<Omit<P, "workspace_domain">>
		: never;

type ClientQuery<D extends Data> =
	NonNullable<D["query"]> extends infer Q extends object
		? OmitIfEmpty<Omit<Q, "project_name">>
		: never;

type PathProp<D extends Data> = [ClientPath<D>] extends [never]
	? { path?: undefined }
	: { path: ClientPath<D> };

type AllPropsOptional<T> = Record<never, never> extends T ? true : false;

type QueryProp<D extends Data> = [ClientQuery<D>] extends [never]
	? { query?: undefined }
	: AllPropsOptional<ClientQuery<D>> extends true
		? { query?: ClientQuery<D> }
		: { query: ClientQuery<D> };

export type ClientData<D extends Data> = Omit<
	WithRequired<D, D["body"] extends undefined ? never : "body">,
	"url" | "path" | "query"
> &
	PathProp<D> &
	QueryProp<D>;
