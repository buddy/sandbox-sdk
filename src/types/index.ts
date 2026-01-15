import type { WithRequired } from "@/types/utils";

export type Data = {
	body?: Record<string, unknown>;
	path?: Record<string, string>;
	query?: Record<string, string | boolean>;
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

type QueryProp<D extends Data> = [ClientQuery<D>] extends [never]
	? { query?: undefined }
	: { query: ClientQuery<D> };

export type ClientData<D extends Data> = Omit<
	WithRequired<D, D["body"] extends undefined ? never : "body">,
	"url" | "path" | "query"
> &
	PathProp<D> &
	QueryProp<D>;
