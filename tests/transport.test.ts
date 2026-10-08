import { afterEach, describe, expect, it, vi } from "vitest";

const http2Transport = vi.fn(async () => Response.json({ via: "http2" }));

vi.mock("@/core/http2-transport", () => ({
	createHttp2Transport: () => http2Transport,
}));

/** Fresh module per test: the transport is chosen once per process */
const loadDefaultTransport = async () => {
	vi.resetModules();
	return (await import("@/core/transport")).defaultTransport;
};

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	http2Transport.mockClear();
});

describe("defaultTransport", () => {
	it("should use HTTP/2 by default", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const transport = await loadDefaultTransport();
		const response = await transport("https://api.test/", { method: "GET" });

		expect(await response.json()).toEqual({ via: "http2" });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("should use fetch when BUDDY_HTTP2=0", async () => {
		vi.stubEnv("BUDDY_HTTP2", "0");
		const fetchMock = vi.fn(async () => Response.json({ via: "fetch" }));
		vi.stubGlobal("fetch", fetchMock);

		const transport = await loadDefaultTransport();
		const response = await transport("https://api.test/", { method: "GET" });

		expect(await response.json()).toEqual({ via: "fetch" });
		expect(http2Transport).not.toHaveBeenCalled();
	});
});
