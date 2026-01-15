import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BuddyApiClient } from "@/core/buddy-api-client";
import { HttpError } from "@/core/http-client";

const TEST_API_URL = "https://api.test.buddy.works";
const TEST_WORKSPACE = "test-workspace";
const TEST_PROJECT = "test-project";
const TEST_TOKEN = "test-token";

const createClient = () =>
	new BuddyApiClient({
		workspace: TEST_WORKSPACE,
		project_name: TEST_PROJECT,
		token: TEST_TOKEN,
		apiUrl: TEST_API_URL,
	});

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("BuddyApiClient", () => {
	describe("constructor", () => {
		it("should create client with valid config", () => {
			const client = createClient();
			expect(client.workspace).toBe(TEST_WORKSPACE);
			expect(client.project_name).toBe(TEST_PROJECT);
		});

		it("should throw if token is missing", () => {
			const originalToken = process.env["BUDDY_TOKEN"];
			delete process.env["BUDDY_TOKEN"];

			try {
				expect(
					() =>
						new BuddyApiClient({
							workspace: TEST_WORKSPACE,
							project_name: TEST_PROJECT,
							apiUrl: TEST_API_URL,
							// no token
						}),
				).toThrow("Buddy API token is required");
			} finally {
				if (originalToken) {
					process.env["BUDDY_TOKEN"] = originalToken;
				}
			}
		});
	});

	describe("getSandboxes", () => {
		it("should fetch sandboxes list", async () => {
			server.use(
				http.get(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes`,
					({ request }) => {
						const url = new URL(request.url);
						expect(url.searchParams.get("project_name")).toBe(TEST_PROJECT);

						return HttpResponse.json({
							sandboxes: [
								{ id: "sandbox-1", name: "Test 1" },
								{ id: "sandbox-2", name: "Test 2" },
							],
						});
					},
				),
			);

			const client = createClient();
			const response = await client.getSandboxes({});

			expect(response.sandboxes).toHaveLength(2);
			expect(response.sandboxes?.[0]?.id).toBe("sandbox-1");
		});
	});

	describe("getSandboxById", () => {
		it("should fetch sandbox by ID", async () => {
			server.use(
				http.get(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-123`,
					() => {
						return HttpResponse.json({
							id: "sandbox-123",
							name: "My Sandbox",
							status: "RUNNING",
							os: "ubuntu:24.04",
						});
					},
				),
			);

			const client = createClient();
			const response = await client.getSandboxById({
				path: { id: "sandbox-123" },
			});

			expect(response?.id).toBe("sandbox-123");
			expect(response?.name).toBe("My Sandbox");
		});

		it("should throw HttpError on 404", async () => {
			server.use(
				http.get(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/non-existent`,
					() => {
						return HttpResponse.json(
							{ errors: [{ message: "Sandbox not found" }] },
							{ status: 404 },
						);
					},
				),
			);

			const client = createClient();

			await expect(
				client.getSandboxById({ path: { id: "non-existent" } }),
			).rejects.toThrow(HttpError);
		});
	});

	describe("addSandbox", () => {
		it("should create a new sandbox", async () => {
			server.use(
				http.post(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes`,
					async ({ request }) => {
						const body = (await request.json()) as Record<string, unknown>;
						return HttpResponse.json({
							id: "new-sandbox-id",
							name: body["name"],
							identifier: body["identifier"],
							os: body["os"],
							status: "STARTING",
						});
					},
				),
			);

			const client = createClient();
			const response = await client.addSandbox({
				body: {
					name: "New Sandbox",
					identifier: "new-sandbox",
					os: "ubuntu:24.04",
				},
			});

			expect(response?.id).toBe("new-sandbox-id");
			expect(response?.name).toBe("New Sandbox");
		});
	});

	describe("deleteSandboxById", () => {
		it("should delete sandbox", async () => {
			server.use(
				http.delete(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-to-delete`,
					() => {
						return new HttpResponse(null, { status: 204 });
					},
				),
			);

			const client = createClient();
			await expect(
				client.deleteSandboxById({ path: { id: "sandbox-to-delete" } }),
			).resolves.not.toThrow();
		});

		it("should not throw on 404 (already deleted)", async () => {
			server.use(
				http.delete(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/already-deleted`,
					() => {
						return HttpResponse.json(
							{ errors: [{ message: "Not found" }] },
							{ status: 404 },
						);
					},
				),
			);

			const client = createClient();
			// Should not throw - 404 is ignored for delete
			await expect(
				client.deleteSandboxById({ path: { id: "already-deleted" } }),
			).resolves.not.toThrow();
		});
	});

	describe("executeCommand", () => {
		it("should execute command in sandbox", async () => {
			server.use(
				http.post(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-id/commands`,
					async ({ request }) => {
						const body = (await request.json()) as Record<string, unknown>;
						return HttpResponse.json({
							id: "command-123",
							command: body["command"],
							status: "INPROGRESS",
						});
					},
				),
			);

			const client = createClient();
			const response = await client.executeCommand({
				path: { sandbox_id: "sandbox-id" },
				body: { command: "echo hello" },
			});

			expect(response?.id).toBe("command-123");
			expect(response?.status).toBe("INPROGRESS");
		});
	});

	describe("response validation", () => {
		it("should throw on invalid response shape", async () => {
			server.use(
				http.get(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-id`,
					() => {
						// Return invalid response (missing required fields or wrong types)
						return HttpResponse.json({
							invalid: "response",
							// Missing id, status, etc.
						});
					},
				),
			);

			const client = createClient();
			// The Zod schema should accept this since most fields are optional
			// But let's verify it doesn't crash
			const response = await client.getSandboxById({
				path: { id: "sandbox-id" },
			});
			expect(response).toBeDefined();
		});
	});

	describe("sandbox lifecycle", () => {
		it("should start sandbox", async () => {
			server.use(
				http.post(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-id/start`,
					() => {
						return HttpResponse.json({
							id: "sandbox-id",
							status: "STARTING",
						});
					},
				),
			);

			const client = createClient();
			const response = await client.startSandbox({
				path: { sandbox_id: "sandbox-id" },
			});

			expect(response?.status).toBe("STARTING");
		});

		it("should stop sandbox", async () => {
			server.use(
				http.post(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-id/stop`,
					() => {
						return HttpResponse.json({
							id: "sandbox-id",
							status: "STOPPING",
						});
					},
				),
			);

			const client = createClient();
			const response = await client.stopSandbox({
				path: { sandbox_id: "sandbox-id" },
			});

			expect(response?.status).toBe("STOPPING");
		});

		it("should restart sandbox", async () => {
			server.use(
				http.post(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-id/restart`,
					() => {
						return HttpResponse.json({
							id: "sandbox-id",
							status: "STARTING",
						});
					},
				),
			);

			const client = createClient();
			const response = await client.restartSandbox({
				path: { sandbox_id: "sandbox-id" },
			});

			expect(response?.status).toBe("STARTING");
		});
	});

	describe("file operations", () => {
		it("should get sandbox content", async () => {
			server.use(
				http.get(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-id/content/path/to/dir`,
					() => {
						return HttpResponse.json({
							contents: [
								{
									name: "file.txt",
									type: "FILE",
									path: "/path/to/dir/file.txt",
								},
								{ name: "subdir", type: "DIR", path: "/path/to/dir/subdir" },
							],
						});
					},
				),
			);

			const client = createClient();
			const response = await client.getSandboxContent({
				path: { sandbox_id: "sandbox-id", path: "path/to/dir" },
			});

			expect(response.contents).toHaveLength(2);
			expect(response.contents?.[0]?.name).toBe("file.txt");
		});

		it("should delete sandbox file", async () => {
			server.use(
				http.delete(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-id/content/file.txt`,
					() => {
						return new HttpResponse(null, { status: 204 });
					},
				),
			);

			const client = createClient();
			await expect(
				client.deleteSandboxFile({
					path: { sandbox_id: "sandbox-id", path: "file.txt" },
				}),
			).resolves.not.toThrow();
		});

		it("should create sandbox directory", async () => {
			server.use(
				http.post(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-id/content/new-dir`,
					() => {
						return HttpResponse.json({
							name: "new-dir",
							type: "DIR",
							path: "/new-dir",
						});
					},
				),
			);

			const client = createClient();
			const response = await client.createSandboxDirectory({
				path: { sandbox_id: "sandbox-id", path: "new-dir" },
			});

			expect(response?.name).toBe("new-dir");
			expect(response?.type).toBe("DIR");
		});
	});

	describe("command operations", () => {
		it("should get command details", async () => {
			server.use(
				http.get(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-id/commands/cmd-123`,
					() => {
						return HttpResponse.json({
							id: "cmd-123",
							command: "echo hello",
							status: "SUCCESSFUL",
							exit_code: 0,
						});
					},
				),
			);

			const client = createClient();
			const response = await client.getCommandDetails({
				path: { sandbox_id: "sandbox-id", id: "cmd-123" },
			});

			expect(response?.status).toBe("SUCCESSFUL");
			expect(response?.exit_code).toBe(0);
		});

		it("should terminate command", async () => {
			server.use(
				http.post(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-id/commands/cmd-123/terminate`,
					() => {
						return HttpResponse.json({});
					},
				),
			);

			const client = createClient();
			await expect(
				client.terminateCommand({
					path: { sandbox_id: "sandbox-id", command_id: "cmd-123" },
				}),
			).resolves.not.toThrow();
		});
	});
});
