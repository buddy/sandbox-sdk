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
	D["path"] extends Record<string, string>
		? OmitIfEmpty<Omit<D["path"], "workspace_domain">>
		: never;

type ClientQuery<D extends Data> =
	D["query"] extends Record<string, string>
		? OmitIfEmpty<Omit<D["query"], "project_name">>
		: never;

export type ClientData<D extends Data> = Omit<
	WithRequired<D, D["body"] extends undefined ? never : "body">,
	"url" | "path" | "query"
> & {
	path?: ClientPath<D>;
	query?: ClientQuery<D>;
};
