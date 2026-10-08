import { STATUS_CODES } from "node:http";
import http2, {
	type ClientHttp2Session,
	type IncomingHttpHeaders,
	type OutgoingHttpHeaders,
} from "node:http2";
import { Readable } from "node:stream";
import { fetchTransport, type Transport } from "@/core/transport";
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

export interface Http2TransportOptions {
	/** Sessions per origin; defaults to `BUDDY_HTTP2_SESSIONS`, else 16 */
	sessions?: number;
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

/** Create a transport over a round-robin pool of HTTP/2 sessions per origin */
export function createHttp2Transport(
	options: Http2TransportOptions = {},
): Transport {
	const count = resolveSessionCount(options.sessions);
	const pools = new Map<string, Pool>();
	const activeStreams = new WeakMap<ClientHttp2Session, number>();
	const draining = new WeakSet<ClientHttp2Session>();

	const connect = (origin: string): ClientHttp2Session => {
		const session = http2.connect(origin);
		session.once("connect", (_session, socket) => {
			// keepAlive passed to http2.connect never reaches a TLS socket
			socket.setKeepAlive(true, KEEP_ALIVE_DELAY_MS);
		});
		session.on("goaway", () => {
			draining.add(session);
		});
		session.on("error", (error) => {
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

	return async (url, init) => {
		const { body, signal } = init;
		if (body !== undefined && body !== null && typeof body !== "string") {
			return fetchTransport(url, init);
		}
		signal?.throwIfAborted();

		const target = new URL(url);
		const method = (init.method ?? "GET").toUpperCase();
		const headers = toRequestHeaders(init.headers);
		headers[":method"] = method;
		headers[":path"] = `${target.pathname}${target.search}`;
		if (typeof body === "string") {
			headers["content-length"] = Buffer.byteLength(body);
		}

		const session = pick(target.origin);
		const stream = session.request(headers, {
			endStream: typeof body !== "string",
		});
		track(session, stream);

		const onAbort = () => stream.destroy(signal?.reason as Error);
		signal?.addEventListener("abort", onAbort, { once: true });
		stream.once("close", () => signal?.removeEventListener("abort", onAbort));

		return new Promise<Response>((resolve, reject) => {
			stream.on("error", reject);
			stream.once("response", (incoming) => {
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
}
