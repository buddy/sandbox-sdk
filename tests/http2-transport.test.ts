import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http2, {
	type Http2Server,
	type Http2Session,
	type IncomingHttpHeaders,
	type ServerHttp2Session,
	type ServerHttp2Stream,
} from "node:http2";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
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
	server.on("stream", (stream, headers) => {
		stream.on("error", () => undefined);
		handler(stream, headers);
	});
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
	vi.restoreAllMocks();
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/**
 * Raw HTTP/2 server: node's own cannot send a GOAWAY that leaves out a
 * received stream. First connection gets GOAWAY(0), later ones get 200.
 */
async function startGoawayServer() {
	let connections = 0;
	let requests = 0;
	const sockets = new Set<net.Socket>();
	const frame = (
		type: number,
		flags: number,
		streamId: number,
		payload = Buffer.alloc(0),
	) => {
		const header = Buffer.alloc(9);
		header.writeUIntBE(payload.length, 0, 3);
		header.writeUInt8(type, 3);
		header.writeUInt8(flags, 4);
		header.writeUInt32BE(streamId, 5);
		return Buffer.concat([header, payload]);
	};
	const raw = net.createServer((socket) => {
		const connection = ++connections;
		sockets.add(socket);
		let buffer = Buffer.alloc(0);
		let prefaceSeen = false;
		socket.on("error", () => undefined);
		socket.write(frame(0x4, 0, 0)); // SETTINGS
		socket.on("data", (chunk: Buffer) => {
			buffer = Buffer.concat([buffer, chunk]);
			if (!prefaceSeen) {
				if (buffer.length < 24) return;
				buffer = buffer.subarray(24);
				prefaceSeen = true;
			}
			while (buffer.length >= 9) {
				const length = buffer.readUIntBE(0, 3);
				if (buffer.length < 9 + length) return;
				const type = buffer.readUInt8(3);
				const flags = buffer.readUInt8(4);
				const streamId = buffer.readUInt32BE(5) & 0x7fffffff;
				buffer = buffer.subarray(9 + length);
				if (type === 0x4 && (flags & 0x1) === 0) {
					socket.write(frame(0x4, 0x1, 0)); // SETTINGS ACK
				}
				if (type === 0x1) {
					requests++;
					if (connection === 1) {
						socket.end(frame(0x7, 0, 0, Buffer.alloc(8)));
					} else {
						// :status 200 is entry 8 of the HPACK static table
						socket.write(frame(0x1, 0x5, streamId, Buffer.from([0x88])));
					}
				}
			}
		});
	});
	await new Promise<void>((resolve) => raw.listen(0, "127.0.0.1", resolve));
	return {
		origin: `http://127.0.0.1:${String((raw.address() as AddressInfo).port)}`,
		requests: () => requests,
		connections: () => connections,
		close: () =>
			new Promise((resolve) => {
				for (const socket of sockets) socket.destroy();
				raw.close(resolve);
			}),
	};
}

describe("createHttp2Transport", () => {
	describe("requests and responses", () => {
		it("should return status, status text, headers and body", async () => {
			handler = (stream) => {
				stream.respond({ ":status": 404, "x-test": "yes" });
				stream.end("nope");
			};

			const transport = createHttp2Transport({
				sessions: 1,
				allowCleartext: true,
			});
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

			const transport = createHttp2Transport({
				sessions: 1,
				allowCleartext: true,
			});
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

			const transport = createHttp2Transport({
				sessions: 1,
				allowCleartext: true,
			});
			const response = await transport(`${origin}/`, { method: "DELETE" });

			expect(response.status).toBe(204);
			expect(response.body).toBeNull();
		});

		it("should hand non-string bodies to fetch", async () => {
			const fetchMock = vi.fn(async () => Response.json({ via: "fetch" }));
			vi.stubGlobal("fetch", fetchMock);

			const transport = createHttp2Transport({
				sessions: 1,
				allowCleartext: true,
			});
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

			const transport = createHttp2Transport({
				sessions: 1,
				allowCleartext: true,
			});
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

			const transport = createHttp2Transport({
				sessions: 1,
				allowCleartext: true,
			});
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

			const transport = createHttp2Transport({
				sessions: 1,
				allowCleartext: true,
			});
			const response = await transport(`${origin}/follow`, { method: "GET" });
			const reader = response.body?.getReader();
			await reader?.read();
			await reader?.cancel();

			await expect(serverStreamClosed).resolves.toBeUndefined();
		});
	});

	describe("session pool", () => {
		it("should open every session on the first request", async () => {
			const transport = createHttp2Transport({
				sessions: 4,
				allowCleartext: true,
			});
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

			const transport = createHttp2Transport({
				sessions: 4,
				allowCleartext: true,
			});
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

			const transport = createHttp2Transport({
				sessions: 2,
				allowCleartext: true,
			});
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

			const transport = createHttp2Transport({
				sessions: 1,
				allowCleartext: true,
			});
			await transport(`${origin}/`, { method: "GET" });
			served[0]?.goaway();
			await new Promise((resolve) => setTimeout(resolve, 20));
			await transport(`${origin}/`, { method: "GET" });

			expect(sessionsOpened).toBe(2);
			expect(idOf(served[1])).toBe(2);
		});
	});

	describe("requests the server never saw", () => {
		const failFirstStream = (first: (stream: ServerHttp2Stream) => void) => {
			let streams = 0;
			handler = (stream) => {
				streams++;
				if (streams === 1) {
					first(stream);
					return;
				}
				stream.respond({ ":status": 200 }, { endStream: true });
			};
			return () => streams;
		};

		it("should send a POST again after REFUSED_STREAM", async () => {
			const streams = failFirstStream((stream) =>
				stream.close(http2.constants.NGHTTP2_REFUSED_STREAM),
			);

			const transport = createHttp2Transport({
				sessions: 2,
				allowCleartext: true,
			});
			const response = await transport(`${origin}/sandboxes`, {
				method: "POST",
				body: "{}",
			});

			expect(response.status).toBe(200);
			expect(streams()).toBe(2);
		});

		it("should send a POST again when a GOAWAY leaves its stream out", async () => {
			const goawayServer = await startGoawayServer();
			try {
				const transport = createHttp2Transport({
					sessions: 1,
					allowCleartext: true,
				});
				const response = await transport(`${goawayServer.origin}/sandboxes`, {
					method: "POST",
					body: "{}",
				});

				expect(response.status).toBe(200);
				expect(goawayServer.requests()).toBe(2);
				expect(goawayServer.connections()).toBe(2);
			} finally {
				await goawayServer.close();
			}
		});

		it("should finish a stream the GOAWAY still covers", async () => {
			const streams = failFirstStream((stream) => {
				stream.session?.goaway(http2.constants.NGHTTP2_NO_ERROR, stream.id);
				stream.respond({ ":status": 200 }, { endStream: true });
			});

			const transport = createHttp2Transport({
				sessions: 1,
				allowCleartext: true,
			});
			const response = await transport(`${origin}/sandboxes`, {
				method: "POST",
				body: "{}",
			});

			expect(response.status).toBe(200);
			expect(streams()).toBe(1);
		});

		it("should send again when the session refuses new streams", async () => {
			const probe = http2.connect(origin);
			const request = vi
				.spyOn(Object.getPrototypeOf(probe), "request")
				.mockImplementationOnce(() => {
					throw Object.assign(
						new Error("New streams cannot be created after receiving a GOAWAY"),
						{ code: "ERR_HTTP2_GOAWAY_SESSION" },
					);
				});
			probe.destroy();

			const transport = createHttp2Transport({
				sessions: 2,
				allowCleartext: true,
			});
			const response = await transport(`${origin}/sandboxes`, {
				method: "POST",
				body: "{}",
			});

			expect(response.status).toBe(200);
			expect(request).toHaveBeenCalledTimes(2);
		});

		it("should go to fetch when the session never connects", async () => {
			const fetchMock = vi.fn(async () => Response.json({ via: "fetch" }));
			vi.stubGlobal("fetch", fetchMock);
			const closed = http2.createServer();
			await new Promise<void>((resolve) =>
				closed.listen(0, "127.0.0.1", resolve),
			);
			const { port } = closed.address() as AddressInfo;
			await new Promise((resolve) => closed.close(resolve));

			const transport = createHttp2Transport({
				sessions: 1,
				allowCleartext: true,
			});
			const response = await transport(
				`http://127.0.0.1:${String(port)}/sandboxes`,
				{ method: "POST", body: "{}" },
			);

			expect(await response.json()).toEqual({ via: "fetch" });
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it("should not send a POST again when it may have reached the server", async () => {
			const fetchMock = vi.fn();
			vi.stubGlobal("fetch", fetchMock);
			let streams = 0;
			handler = (stream) => {
				streams++;
				stream.session?.destroy();
			};

			const transport = createHttp2Transport({
				sessions: 2,
				allowCleartext: true,
			});
			await expect(
				transport(`${origin}/sandboxes`, { method: "POST", body: "{}" }),
			).rejects.toThrow();

			expect(streams).toBe(1);
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe("origins that stay on fetch", () => {
		let certificate: { key: Buffer; cert: Buffer };

		beforeAll(() => {
			const dir = mkdtempSync(join(tmpdir(), "sdk-tls-"));
			try {
				const key = join(dir, "key.pem");
				const cert = join(dir, "cert.pem");
				const args =
					"req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost";
				execFileSync(
					"openssl",
					[...args.split(" "), "-keyout", key, "-out", cert],
					{
						stdio: "ignore",
					},
				);
				certificate = { key: readFileSync(key), cert: readFileSync(cert) };
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});

		const withTlsServer = async (
			server: tls.Server,
			test: (origin: string, connections: () => number) => Promise<void>,
		) => {
			let connections = 0;
			const sockets = new Set<net.Socket>();
			server.on("secureConnection", (socket) => {
				connections++;
				sockets.add(socket);
				socket.on("error", () => undefined);
			});
			server.on("tlsClientError", () => undefined);
			await new Promise<void>((resolve) =>
				server.listen(0, "127.0.0.1", resolve),
			);
			// Self-signed fixture
			vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");
			try {
				const { port } = server.address() as AddressInfo;
				await test(`https://127.0.0.1:${String(port)}`, () => connections);
			} finally {
				for (const socket of sockets) socket.destroy();
				await new Promise((resolve) => server.close(resolve));
			}
		};

		const stubFetch = () => {
			const fetchMock = vi.fn(async () => Response.json({ via: "fetch" }));
			vi.stubGlobal("fetch", fetchMock);
			return fetchMock;
		};

		it("should send a POST to fetch when the server picks no protocol", async () => {
			const fetchMock = stubFetch();
			// No ALPN: handshake succeeds without h2
			const server = tls.createServer(certificate, (socket) => {
				socket.on("data", () => undefined);
			});

			await withTlsServer(server, async (origin, connections) => {
				const transport = createHttp2Transport({ sessions: 1 });
				const first = await transport(`${origin}/sandboxes`, {
					method: "POST",
					body: "{}",
				});
				const opened = connections();
				await transport(`${origin}/sandboxes`, { method: "GET" });

				expect(await first.json()).toEqual({ via: "fetch" });
				expect(fetchMock).toHaveBeenCalledTimes(2);
				expect(connections()).toBe(opened);
			});
		});

		it("should send a POST to fetch when the server refuses h2", async () => {
			const fetchMock = stubFetch();
			// Answers an h2 offer with a TLS alert
			const server = https.createServer(certificate, (_request, response) =>
				response.end(),
			);

			await withTlsServer(server, async (origin, connections) => {
				const transport = createHttp2Transport({ sessions: 1 });
				const first = await transport(`${origin}/sandboxes`, {
					method: "POST",
					body: "{}",
				});
				const opened = connections();
				await transport(`${origin}/sandboxes`, { method: "GET" });

				expect(await first.json()).toEqual({ via: "fetch" });
				expect(fetchMock).toHaveBeenCalledTimes(2);
				expect(connections()).toBe(opened);
			});
		});

		it("should send http origins to fetch", async () => {
			const fetchMock = stubFetch();

			const transport = createHttp2Transport({ sessions: 2 });
			await transport(`${origin}/`, { method: "GET" });

			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(sessionsOpened).toBe(0);
		});

		it("should send everything to fetch when a proxy is set", async () => {
			const fetchMock = stubFetch();
			vi.stubEnv("HTTPS_PROXY", "http://proxy.example:3128");

			const transport = createHttp2Transport({
				sessions: 2,
				allowCleartext: true,
			});
			await transport(`${origin}/`, { method: "GET" });

			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(sessionsOpened).toBe(0);
		});
	});

	describe("session count", () => {
		it("should read the session count from BUDDY_HTTP2_SESSIONS", async () => {
			vi.stubEnv("BUDDY_HTTP2_SESSIONS", "3");

			const transport = createHttp2Transport({ allowCleartext: true });
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

			expect(() => createHttp2Transport({ allowCleartext: true })).toThrow(
				/BUDDY_HTTP2_SESSIONS/,
			);
		});
	});
});
