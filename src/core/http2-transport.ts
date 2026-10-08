import { STATUS_CODES } from "node:http";
import http2, {
	type ClientHttp2Session,
	type IncomingHttpHeaders,
	type OutgoingHttpHeaders,
} from "node:http2";
import { Readable } from "node:stream";
import type { Transport } from "@/core/transport";
import environment from "@/utils/environment";
import logger from "@/utils/logger";

const DEFAULT_SESSIONS = 16;
const MAX_SESSIONS = 64;

/** Keeps idle NAT mappings alive and surfaces dead connections as errors */
const KEEP_ALIVE_DELAY_MS = 60_000;

/** Headers HTTP/2 forbids */
const CONNECTION_HEADERS = new Set([
	"connection",
	"keep-alive",
	"proxy-connection",
	"transfer-encoding",
	"upgrade",
	"host",
	"http2-settings",
]);

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/** HTTP/2 attempts for a request the server never saw, before fetch */
const MAX_HTTP2_ATTEMPTS = 2;

/** Thrown by `session.request()` when the session takes no new streams */
const SESSION_REFUSED_CODES = new Set([
	"ERR_HTTP2_GOAWAY_SESSION",
	"ERR_HTTP2_INVALID_SESSION",
	"ERR_HTTP2_OUT_OF_STREAMS",
]);

/** `http2.connect` ignores proxies */
const PROXY_VARIABLES = [
	"HTTPS_PROXY",
	"https_proxy",
	"HTTP_PROXY",
	"http_proxy",
	"ALL_PROXY",
	"all_proxy",
];

/** TLS alert from a server that refuses h2 */
const NO_APPLICATION_PROTOCOL = "ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL";

export interface Http2TransportOptions {
	/** Sessions per origin; defaults to `BUDDY_HTTP2_SESSIONS`, else 16 */
	sessions?: number;
	/** @internal Use h2c for `http:` origins (tests) */
	allowCleartext?: boolean;
}

interface Pool {
	slots: (ClientHttp2Session | undefined)[];
	next: number;
}

function resolveSessionCount(sessions?: number): number {
	const raw = sessions ?? environment.BUDDY_HTTP2_SESSIONS;
	if (raw === undefined) {
		return DEFAULT_SESSIONS;
	}
	const count = Number(raw);
	if (!Number.isInteger(count) || count < 1 || count > MAX_SESSIONS) {
		throw new Error(
			`BUDDY_HTTP2_SESSIONS must be an integer from 1 to ${String(MAX_SESSIONS)}, got: ${String(raw)}`,
		);
	}
	return count;
}

function toRequestHeaders(init: RequestInit["headers"]): OutgoingHttpHeaders {
	const headers: OutgoingHttpHeaders = {};
	new Headers(init).forEach((value, name) => {
		if (!CONNECTION_HEADERS.has(name)) {
			headers[name] = value;
		}
	});
	// Nothing here decompresses
	headers["accept-encoding"] = "identity";
	return headers;
}

function toResponseHeaders(incoming: IncomingHttpHeaders): Headers {
	const headers = new Headers();
	for (const [name, value] of Object.entries(incoming)) {
		if (name.startsWith(":") || value === undefined) {
			continue;
		}
		for (const item of Array.isArray(value) ? value : [value]) {
			headers.append(name, String(item));
		}
	}
	return headers;
}

/**
 * Create a transport over a round-robin pool of HTTP/2 sessions per origin.
 * Requests the server never saw are sent again, even POSTs.
 */
export function createHttp2Transport(
	options: Http2TransportOptions = {},
): Transport {
	const count = resolveSessionCount(options.sessions);
	const proxy = PROXY_VARIABLES.find((name) => process.env[name]);
	const pools = new Map<string, Pool>();
	const activeStreams = new WeakMap<ClientHttp2Session, number>();
	const draining = new WeakSet<ClientHttp2Session>();
	const fetchOrigins = new Map<string, string>();

	const sendToFetch = (origin: string, reason: string) => {
		if (!fetchOrigins.has(origin)) {
			fetchOrigins.set(origin, reason);
			logger.debug("[HTTP2] Origin switched to fetch", { origin, reason });
		}
	};

	const fetchReason = (origin: string): string | undefined => {
		const known = fetchOrigins.get(origin);
		if (known) {
			return known;
		}
		if (proxy) {
			sendToFetch(origin, `${proxy} is set`);
		} else if (!origin.startsWith("https:") && !options.allowCleartext) {
			sendToFetch(origin, "not an https origin");
		}
		return fetchOrigins.get(origin);
	};

	const connect = (origin: string): ClientHttp2Session => {
		const session = http2.connect(origin);
		session.once("connect", (_session, socket) => {
			// Runs before buffered streams go out, so they stay unsent
			if (origin.startsWith("https:") && session.alpnProtocol !== "h2") {
				sendToFetch(origin, "the server does not offer h2");
				session.destroy();
				return;
			}
			// keepAlive passed to http2.connect never reaches a TLS socket
			socket.setKeepAlive(true, KEEP_ALIVE_DELAY_MS);
		});
		session.on("goaway", () => {
			draining.add(session);
		});
		session.on("error", (error) => {
			if ((error as { code?: unknown }).code === NO_APPLICATION_PROTOCOL) {
				sendToFetch(origin, "the server does not offer h2");
			}
			logger.debug("[HTTP2] Session error", { origin, error: error.message });
		});
		session.unref();
		return session;
	};

	const pick = (origin: string): ClientHttp2Session => {
		let pool = pools.get(origin);
		if (!pool) {
			// Warm up: requests on a connecting session are buffered
			pool = {
				slots: Array.from({ length: count }, () => connect(origin)),
				next: 0,
			};
			pools.set(origin, pool);
		}

		const index = pool.next % count;
		pool.next = index + 1;
		const session = pool.slots[index];
		if (
			session &&
			!session.closed &&
			!session.destroyed &&
			!draining.has(session)
		) {
			return session;
		}

		if (session && !session.destroyed) {
			session.close();
		}
		const replacement = connect(origin);
		pool.slots[index] = replacement;
		return replacement;
	};

	const track = (
		session: ClientHttp2Session,
		stream: http2.ClientHttp2Stream,
	) => {
		activeStreams.set(session, (activeStreams.get(session) ?? 0) + 1);
		session.ref();
		stream.once("close", () => {
			const remaining = (activeStreams.get(session) ?? 1) - 1;
			activeStreams.set(session, remaining);
			if (remaining === 0 && !session.destroyed) {
				session.unref();
			}
		});
	};

	/** GOAWAY-excluded streams also close as REFUSED_STREAM */
	const wasNotSent = (stream: http2.ClientHttp2Stream): boolean =>
		stream.id === undefined ||
		stream.rstCode === http2.constants.NGHTTP2_REFUSED_STREAM;

	const send = async (
		url: string,
		init: RequestInit,
		attempt: number,
	): Promise<Response> => {
		const { body, signal } = init;
		signal?.throwIfAborted();

		const target = new URL(url);
		if (fetchReason(target.origin)) {
			return fetch(url, init);
		}
		const method = (init.method ?? "GET").toUpperCase();
		const headers = toRequestHeaders(init.headers);
		headers[":method"] = method;
		headers[":path"] = `${target.pathname}${target.search}`;
		if (typeof body === "string") {
			headers["content-length"] = Buffer.byteLength(body);
		}

		const session = pick(target.origin);
		let stream: http2.ClientHttp2Stream;
		try {
			stream = session.request(headers, {
				endStream: typeof body !== "string",
			});
		} catch (error) {
			// Nothing was sent, so even a POST is safe to send again
			const code = (error as { code?: unknown }).code;
			if (typeof code === "string" && SESSION_REFUSED_CODES.has(code)) {
				draining.add(session);
				return resend(url, init, attempt, error);
			}
			logger.debug("[HTTP2] Session rejected the request, using fetch", {
				url,
				error: error instanceof Error ? error.message : String(error),
			});
			return fetch(url, init);
		}
		track(session, stream);

		const onAbort = () => stream.destroy(signal?.reason as Error);
		signal?.addEventListener("abort", onAbort, { once: true });
		stream.once("close", () => signal?.removeEventListener("abort", onAbort));

		return new Promise<Response>((resolve, reject) => {
			let settled = false;
			const fail = (error: Error) => {
				if (settled) {
					return;
				}
				settled = true;
				if (!signal?.aborted && wasNotSent(stream)) {
					resolve(resend(url, init, attempt, error));
					return;
				}
				reject(error);
			};
			stream.on("error", fail);
			// Dropped sessions close streams without an error
			stream.once("close", () =>
				fail(
					new Error(
						`HTTP/2 stream closed before a response (code ${String(stream.rstCode)})`,
					),
				),
			);
			stream.once("response", (incoming) => {
				settled = true;
				const status = Number(incoming[":status"]);
				const nullBody = NULL_BODY_STATUSES.has(status) || method === "HEAD";
				if (nullBody) {
					stream.resume();
				}
				resolve(
					new Response(
						nullBody
							? null
							: (Readable.toWeb(
									stream,
								) as unknown as ReadableStream<Uint8Array>),
						{
							status,
							statusText: STATUS_CODES[status] ?? "",
							headers: toResponseHeaders(incoming),
						},
					),
				);
			});
			if (typeof body === "string") {
				stream.end(body);
			}
		});
	};

	const resend = (
		url: string,
		init: RequestInit,
		attempt: number,
		error: unknown,
	): Promise<Response> => {
		const viaFetch = attempt >= MAX_HTTP2_ATTEMPTS;
		logger.debug("[HTTP2] Request never reached the server, sending again", {
			url,
			attempt,
			via: viaFetch ? "fetch" : "http2",
			reason: error instanceof Error ? error.message : String(error),
		});
		return viaFetch ? fetch(url, init) : send(url, init, attempt + 1);
	};

	return async (url, init) => {
		const { body } = init;
		if (body !== undefined && body !== null && typeof body !== "string") {
			return fetch(url, init);
		}
		return send(url, init, 1);
	};
}
