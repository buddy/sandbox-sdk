import http2, {
	type Http2Server,
	type Http2Session,
	type IncomingHttpHeaders,
	type ServerHttp2Session,
	type ServerHttp2Stream,
} from "node:http2";
import type { AddressInfo } from "node:net";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { createHttp2Transport } from "@/core/http2-transport";

type Handler = (
	stream: ServerHttp2Stream,
	headers: IncomingHttpHeaders,
) => void;

let server: Http2Server;
let origin: string;
let handler: Handler;
let sessionsOpened: number;
const serverSessions = new Set<ServerHttp2Session>();
// Compare ids: vitest cannot print session objects
const sessionIds = new WeakMap<Http2Session, number>();
const idOf = (session: Http2Session | undefined) =>
	session ? sessionIds.get(session) : undefined;

beforeAll(async () => {
	server = http2.createServer();
	server.on("session", (session) => {
		sessionsOpened++;
		sessionIds.set(session, sessionsOpened);
		serverSessions.add(session);
		session.on("close", () => serverSessions.delete(session));
	});
	server.on("stream", (stream, headers) => handler(stream, headers));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

beforeEach(() => {
	sessionsOpened = 0;
	handler = (stream) => stream.respond({ ":status": 200 }, { endStream: true });
});

afterEach(() => {
	for (const session of serverSessions) session.destroy();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("createHttp2Transport", () => {
	describe("requests and responses", () => {
		it("should return status, status text, headers and body", async () => {
			handler = (stream) => {
				stream.respond({ ":status": 404, "x-test": "yes" });
				stream.end("nope");
			};

			const transport = createHttp2Transport({ sessions: 1 });
			const response = await transport(`${origin}/missing`, { method: "GET" });

			expect(response.status).toBe(404);
			expect(response.statusText).toBe("Not Found");
			expect(response.headers.get("x-test")).toBe("yes");
			expect(await response.text()).toBe("nope");
		});

		it("should send method, path, body and identity encoding, without connection headers", async () => {
			let received: { headers: IncomingHttpHeaders; body: string } | undefined;
			handler = (stream, headers) => {
				let body = "";
				stream.setEncoding("utf8");
				stream.on("data", (chunk: string) => {
					body += chunk;
				});
				stream.on("end", () => {
					received = { headers, body };
					stream.respond({ ":status": 201 }, { endStream: true });
				});
			};

			const transport = createHttp2Transport({ sessions: 1 });
			const response = await transport(`${origin}/items?x=1`, {
				method: "POST",
				headers: {
					Connection: "keep-alive",
					"Content-Type": "application/json",
				},
				body: '{"a":1}',
			});

			expect(response.status).toBe(201);
			expect(received?.headers[":method"]).toBe("POST");
			expect(received?.headers[":path"]).toBe("/items?x=1");
			expect(received?.headers["content-type"]).toBe("application/json");
			expect(received?.headers["content-length"]).toBe("7");
			expect(received?.headers["accept-encoding"]).toBe("identity");
			expect(received?.headers["connection"]).toBeUndefined();
			expect(received?.body).toBe('{"a":1}');
		});

		it("should return a null body for 204", async () => {
			handler = (stream) =>
				stream.respond({ ":status": 204 }, { endStream: true });

			const transport = createHttp2Transport({ sessions: 1 });
			const response = await transport(`${origin}/`, { method: "DELETE" });

			expect(response.status).toBe(204);
			expect(response.body).toBeNull();
		});

		it("should hand non-string bodies to fetch", async () => {
			const fetchMock = vi.fn(async () => Response.json({ via: "fetch" }));
			vi.stubGlobal("fetch", fetchMock);

			const transport = createHttp2Transport({ sessions: 1 });
			const response = await transport(`${origin}/upload`, {
				method: "POST",
				body: new FormData(),
			});

			expect(await response.json()).toEqual({ via: "fetch" });
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});
	});

	describe("abort and cancel", () => {
		it("should reject with AbortError when aborted before the response", async () => {
			handler = () => {
				// never respond
			};
			const controller = new AbortController();

			const transport = createHttp2Transport({ sessions: 1 });
			const pending = transport(`${origin}/slow`, {
				method: "GET",
				signal: controller.signal,
			});
			setTimeout(() => controller.abort(), 20);

			await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		});

		it("should error the body with AbortError when aborted mid-body", async () => {
			handler = (stream) => {
				stream.respond({ ":status": 200 });
				stream.write("partial");
			};
			const controller = new AbortController();

			const transport = createHttp2Transport({ sessions: 1 });
			const response = await transport(`${origin}/stall`, {
				method: "GET",
				signal: controller.signal,
			});
			const text = response.text();
			controller.abort();

			await expect(text).rejects.toMatchObject({ name: "AbortError" });
		});

		it("should close the stream when the consumer cancels the body", async () => {
			let serverStreamClosed: Promise<void> = Promise.resolve();
			handler = (stream) => {
				serverStreamClosed = new Promise((resolve) =>
					stream.on("close", resolve),
				);
				stream.respond({ ":status": 200 });
				stream.write("first chunk of a stream that never ends");
			};

			const transport = createHttp2Transport({ sessions: 1 });
			const response = await transport(`${origin}/follow`, { method: "GET" });
			const reader = response.body?.getReader();
			await reader?.read();
			await reader?.cancel();

			await expect(serverStreamClosed).resolves.toBeUndefined();
		});
	});

	describe("session pool", () => {
		it("should open every session on the first request", async () => {
			const transport = createHttp2Transport({ sessions: 4 });
			await transport(`${origin}/`, { method: "GET" });

			await vi.waitFor(() => expect(sessionsOpened).toBe(4));
		});

		it("should spread requests across the sessions in turn", async () => {
			const streamsPerSession = new Map<number | undefined, number>();
			handler = (stream) => {
				const id = idOf(stream.session);
				streamsPerSession.set(id, (streamsPerSession.get(id) ?? 0) + 1);
				stream.respond({ ":status": 200 }, { endStream: true });
			};

			const transport = createHttp2Transport({ sessions: 4 });
			for (let i = 0; i < 8; i++) {
				await transport(`${origin}/`, { method: "GET" });
			}

			expect([...streamsPerSession.values()]).toEqual([2, 2, 2, 2]);
		});

		it("should replace a closed session in its slot on its next turn", async () => {
			const served: (Http2Session | undefined)[] = [];
			handler = (stream) => {
				served.push(stream.session);
				stream.respond({ ":status": 200 }, { endStream: true });
			};

			const transport = createHttp2Transport({ sessions: 2 });
			await transport(`${origin}/`, { method: "GET" });
			await transport(`${origin}/`, { method: "GET" });
			served[0]?.destroy();
			await vi.waitFor(() => expect(serverSessions.size).toBe(1));
			await new Promise((resolve) => setTimeout(resolve, 20));

			await transport(`${origin}/`, { method: "GET" });
			await transport(`${origin}/`, { method: "GET" });

			expect(sessionsOpened).toBe(3);
			expect(idOf(served[2])).toBe(3);
			expect(idOf(served[3])).toBe(idOf(served[1]));
		});

		it("should replace a session after a GOAWAY", async () => {
			const served: (Http2Session | undefined)[] = [];
			handler = (stream) => {
				served.push(stream.session);
				stream.respond({ ":status": 200 }, { endStream: true });
			};

			const transport = createHttp2Transport({ sessions: 1 });
			await transport(`${origin}/`, { method: "GET" });
			served[0]?.goaway();
			await new Promise((resolve) => setTimeout(resolve, 20));
			await transport(`${origin}/`, { method: "GET" });

			expect(sessionsOpened).toBe(2);
			expect(idOf(served[1])).toBe(2);
		});
	});

	describe("session count", () => {
		it("should read the session count from BUDDY_HTTP2_SESSIONS", async () => {
			vi.stubEnv("BUDDY_HTTP2_SESSIONS", "3");

			const transport = createHttp2Transport();
			await transport(`${origin}/`, { method: "GET" });

			await vi.waitFor(() => expect(sessionsOpened).toBe(3));
		});

		it.each([
			"0",
			"-1",
			"1.5",
			"abc",
			"65",
		])("should reject BUDDY_HTTP2_SESSIONS=%s", (value) => {
			vi.stubEnv("BUDDY_HTTP2_SESSIONS", value);

			expect(() => createHttp2Transport()).toThrow(/BUDDY_HTTP2_SESSIONS/);
		});
	});
});
