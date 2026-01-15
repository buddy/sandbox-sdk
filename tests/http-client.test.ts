import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { HttpClient, HttpError } from "@/core/http-client";

const TEST_BASE_URL = "https://test-api.example.com";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("HttpClient", () => {
	describe("basic requests", () => {
		it("should make GET request", async () => {
			server.use(
				http.get(`${TEST_BASE_URL}/test`, () => {
					return HttpResponse.json({ success: true });
				}),
			);

			const client = new HttpClient({ baseURL: TEST_BASE_URL });
			const response = await client.get("/test");

			expect(response.status).toBe(200);
			expect(response.data).toEqual({ success: true });
		});

		it("should make POST request with body", async () => {
			server.use(
				http.post(`${TEST_BASE_URL}/test`, async ({ request }) => {
					const body = await request.json();
					return HttpResponse.json({ received: body });
				}),
			);

			const client = new HttpClient({ baseURL: TEST_BASE_URL });
			const response = await client.post("/test", { foo: "bar" });

			expect(response.status).toBe(200);
			expect(response.data).toEqual({ received: { foo: "bar" } });
		});

		it("should make DELETE request", async () => {
			server.use(
				http.delete(`${TEST_BASE_URL}/test/123`, () => {
					return HttpResponse.json({ deleted: true });
				}),
			);

			const client = new HttpClient({ baseURL: TEST_BASE_URL });
			const response = await client.delete("/test/123");

			expect(response.status).toBe(200);
			expect(response.data).toEqual({ deleted: true });
		});
	});

	describe("query parameters", () => {
		it("should append query params to URL", async () => {
			server.use(
				http.get(`${TEST_BASE_URL}/search`, ({ request }) => {
					const url = new URL(request.url);
					return HttpResponse.json({
						q: url.searchParams.get("q"),
						limit: url.searchParams.get("limit"),
					});
				}),
			);

			const client = new HttpClient({ baseURL: TEST_BASE_URL });
			const response = await client.get("/search", {
				queryParams: { q: "test", limit: 10 },
			});

			expect(response.data).toEqual({ q: "test", limit: "10" });
		});

		it("should skip undefined query params", async () => {
			server.use(
				http.get(`${TEST_BASE_URL}/search`, ({ request }) => {
					const url = new URL(request.url);
					return HttpResponse.json({
						hasQ: url.searchParams.has("q"),
						hasUndefined: url.searchParams.has("undefined"),
					});
				}),
			);

			const client = new HttpClient({ baseURL: TEST_BASE_URL });
			const response = await client.get("/search", {
				queryParams: { q: "test", undefined: undefined },
			});

			expect(response.data).toEqual({ hasQ: true, hasUndefined: false });
		});
	});

	describe("headers", () => {
		it("should send default headers", async () => {
			server.use(
				http.get(`${TEST_BASE_URL}/headers`, ({ request }) => {
					return HttpResponse.json({
						contentType: request.headers.get("Content-Type"),
					});
				}),
			);

			const client = new HttpClient({ baseURL: TEST_BASE_URL });
			const response = await client.get("/headers");

			expect(response.data).toEqual({ contentType: "application/json" });
		});

		it("should send custom headers from config", async () => {
			server.use(
				http.get(`${TEST_BASE_URL}/headers`, ({ request }) => {
					return HttpResponse.json({
						custom: request.headers.get("X-Custom-Header"),
					});
				}),
			);

			const client = new HttpClient({
				baseURL: TEST_BASE_URL,
				headers: { "X-Custom-Header": "custom-value" },
			});
			const response = await client.get("/headers");

			expect(response.data).toEqual({ custom: "custom-value" });
		});

		it("should send per-request headers", async () => {
			server.use(
				http.get(`${TEST_BASE_URL}/headers`, ({ request }) => {
					return HttpResponse.json({
						perRequest: request.headers.get("X-Per-Request"),
					});
				}),
			);

			const client = new HttpClient({ baseURL: TEST_BASE_URL });
			const response = await client.get("/headers", {
				headers: { "X-Per-Request": "request-value" },
			});

			expect(response.data).toEqual({ perRequest: "request-value" });
		});

		it("should send auth token when set", async () => {
			server.use(
				http.get(`${TEST_BASE_URL}/auth`, ({ request }) => {
					return HttpResponse.json({
						auth: request.headers.get("Authorization"),
					});
				}),
			);

			const client = new HttpClient({ baseURL: TEST_BASE_URL });
			client.setAuthToken("my-token");
			const response = await client.get("/auth");

			expect(response.data).toEqual({ auth: "Bearer my-token" });
		});
	});

	describe("retry logic", () => {
		it("should retry on 503 and eventually succeed", async () => {
			let attempts = 0;
			server.use(
				http.get(`${TEST_BASE_URL}/retry`, () => {
					attempts++;
					if (attempts < 3) {
						return HttpResponse.json(
							{ error: "Service unavailable" },
							{ status: 503 },
						);
					}
					return HttpResponse.json({ success: true });
				}),
			);

			const client = new HttpClient({ baseURL: TEST_BASE_URL });
			const response = await client.get("/retry");

			expect(attempts).toBe(3);
			expect(response.data).toEqual({ success: true });
		});

		it("should retry on 429 (rate limit)", async () => {
			let attempts = 0;
			server.use(
				http.get(`${TEST_BASE_URL}/rate-limit`, () => {
					attempts++;
					if (attempts < 2) {
						return HttpResponse.json(
							{ error: "Too many requests" },
							{ status: 429 },
						);
					}
					return HttpResponse.json({ success: true });
				}),
			);

			const client = new HttpClient({ baseURL: TEST_BASE_URL });
			const response = await client.get("/rate-limit");

			expect(attempts).toBe(2);
			expect(response.data).toEqual({ success: true });
		});

		it("should NOT retry on 400 (client error)", async () => {
			let attempts = 0;
			server.use(
				http.get(`${TEST_BASE_URL}/bad-request`, () => {
					attempts++;
					return HttpResponse.json({ error: "Bad request" }, { status: 400 });
				}),
			);

			const client = new HttpClient({ baseURL: TEST_BASE_URL });

			await expect(client.get("/bad-request")).rejects.toThrow(HttpError);
			expect(attempts).toBe(1);
		});

		it("should NOT retry on 401 (unauthorized)", async () => {
			let attempts = 0;
			server.use(
				http.get(`${TEST_BASE_URL}/unauthorized`, () => {
					attempts++;
					return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
				}),
			);

			const client = new HttpClient({ baseURL: TEST_BASE_URL });

			await expect(client.get("/unauthorized")).rejects.toThrow(HttpError);
			expect(attempts).toBe(1);
		});

		it("should NOT retry on 404 (not found)", async () => {
			let attempts = 0;
			server.use(
				http.get(`${TEST_BASE_URL}/not-found`, () => {
					attempts++;
					return HttpResponse.json({ error: "Not found" }, { status: 404 });
				}),
			);

			const client = new HttpClient({ baseURL: TEST_BASE_URL });

			await expect(client.get("/not-found")).rejects.toThrow(HttpError);
			expect(attempts).toBe(1);
		});

		it("should skip retry when skipRetry is true", async () => {
			let attempts = 0;
			server.use(
				http.get(`${TEST_BASE_URL}/no-retry`, () => {
					attempts++;
					return HttpResponse.json(
						{ error: "Service unavailable" },
						{ status: 503 },
					);
				}),
			);

			const client = new HttpClient({ baseURL: TEST_BASE_URL });

			await expect(
				client.get("/no-retry", { skipRetry: true }),
			).rejects.toThrow(HttpError);
			expect(attempts).toBe(1);
		});

		it("should fail after max retries on persistent 500", async () => {
			let attempts = 0;
			server.use(
				http.get(`${TEST_BASE_URL}/always-fail`, () => {
					attempts++;
					return HttpResponse.json(
						{ error: "Internal server error" },
						{ status: 500 },
					);
				}),
			);

			const client = new HttpClient({ baseURL: TEST_BASE_URL });

			await expect(client.get("/always-fail")).rejects.toThrow(HttpError);
			expect(attempts).toBe(4); // 1 initial + 3 retries
		});
	});

	describe("response types", () => {
		it("should parse JSON by default", async () => {
			server.use(
				http.get(`${TEST_BASE_URL}/json`, () => {
					return HttpResponse.json({ key: "value" });
				}),
			);

			const client = new HttpClient({ baseURL: TEST_BASE_URL });
			const response = await client.get("/json");

			expect(response.data).toEqual({ key: "value" });
		});

		it("should return text when responseType is text", async () => {
			server.use(
				http.get(`${TEST_BASE_URL}/text`, () => {
					return HttpResponse.text("plain text response");
				}),
			);

			const client = new HttpClient({ baseURL: TEST_BASE_URL });
			const response = await client.get("/text", { responseType: "text" });

			expect(response.data).toBe("plain text response");
		});

		it("should handle empty response body", async () => {
			server.use(
				http.get(`${TEST_BASE_URL}/empty`, () => {
					return new HttpResponse(null, { status: 204 });
				}),
			);

			const client = new HttpClient({ baseURL: TEST_BASE_URL });
			const response = await client.get("/empty");

			expect(response.status).toBe(204);
			expect(response.data).toBeUndefined();
		});
	});
});

describe("HttpError", () => {
	it("should include status code in message", () => {
		const error = new HttpError("Not Found", 404);
		expect(error.message).toBe("HTTP 404: Not Found");
		expect(error.status).toBe(404);
	});

	it("should extract API errors array from response", () => {
		const response = {
			status: 400,
			statusText: "Bad Request",
			data: {
				errors: [
					{ message: "Field is required" },
					{ message: "Invalid format" },
				],
			},
			headers: new Headers(),
		};

		const error = new HttpError("Bad Request", 400, response);

		expect(error.message).toContain("Field is required");
		expect(error.message).toContain("Invalid format");
		expect(error.errors).toEqual([
			{ message: "Field is required" },
			{ message: "Invalid format" },
		]);
	});

	it("should handle string errors in array", () => {
		const response = {
			status: 400,
			statusText: "Bad Request",
			data: {
				errors: ["Error 1", "Error 2"],
			},
			headers: new Headers(),
		};

		const error = new HttpError("Bad Request", 400, response);

		expect(error.message).toContain("Error 1");
		expect(error.message).toContain("Error 2");
	});

	it("should handle response without errors array", () => {
		const response = {
			status: 500,
			statusText: "Internal Server Error",
			data: { message: "Something went wrong" },
			headers: new Headers(),
		};

		const error = new HttpError("Internal Server Error", 500, response);

		expect(error.message).toBe("HTTP 500: Internal Server Error");
		expect(error.errors).toBeUndefined();
	});

	it("should be instanceof Error", () => {
		const error = new HttpError("Test", 500);
		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(HttpError);
		expect(error.name).toBe("HttpError");
	});
});
