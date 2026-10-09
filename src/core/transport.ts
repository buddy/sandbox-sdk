import { createHttp2Transport } from "@/core/http2-transport";
import environment from "@/utils/environment";

/** Sends one HTTP request, shaped like `fetch` */
export type Transport = (url: string, init: RequestInit) => Promise<Response>;

/** Global `fetch`, looked up per call so msw can intercept it */
const fetchTransport: Transport = (url, init) => fetch(url, init);

let selected: Transport | undefined;

/** HTTP/2 unless `BUDDY_HTTP2=0`; chosen on the first request, shared by the process */
export const defaultTransport: Transport = (url, init) => {
	selected ??=
		environment.BUDDY_HTTP2 === "0" ? fetchTransport : createHttp2Transport();
	return selected(url, init);
};
