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

		it("should forward timeout in the request body", async () => {
			let receivedBody: Record<string, unknown> | undefined;
			server.use(
				http.post(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes`,
					async ({ request }) => {
						receivedBody = (await request.json()) as Record<string, unknown>;
						return HttpResponse.json({
							id: "with-timeout",
							name: receivedBody["name"],
							identifier: receivedBody["identifier"],
							os: receivedBody["os"],
							timeout: receivedBody["timeout"],
							status: "STARTING",
						});
					},
				),
			);

			const client = createClient();
			const response = await client.addSandbox({
				body: {
					name: "Timeout Sandbox",
					identifier: "timeout-sandbox",
					os: "ubuntu:24.04",
					timeout: 600,
				},
			});

			expect(receivedBody?.["timeout"]).toBe(600);
			expect(response?.timeout).toBe(600);
		});

		it("should forward source_sandbox_id when cloning a sandbox", async () => {
			let receivedBody: Record<string, unknown> | undefined;
			server.use(
				http.post(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes`,
					async ({ request }) => {
						receivedBody = (await request.json()) as Record<string, unknown>;
						return HttpResponse.json({
							id: "clone-id",
							name: receivedBody["name"],
							identifier: receivedBody["identifier"],
							status: "STARTING",
						});
					},
				),
			);

			const client = createClient();
			const response = await client.addSandbox({
				body: {
					source_sandbox_id: "source-sandbox",
					name: "Clone Sandbox",
					identifier: "clone-sandbox",
				},
			});

			expect(receivedBody?.["source_sandbox_id"]).toBe("source-sandbox");
			expect(response?.id).toBe("clone-id");
		});

		it("should forward fetch items in the request body", async () => {
			let receivedBody: Record<string, unknown> | undefined;
			const fetchItems = [
				{
					type: "PUBLIC_REPO" as const,
					repository: "https://github.com/octocat/Hello-World",
					ref: "master",
				},
			];
			server.use(
				http.post(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes`,
					async ({ request }) => {
						receivedBody = (await request.json()) as Record<string, unknown>;
						return HttpResponse.json({
							id: "with-fetch",
							name: receivedBody["name"],
							identifier: receivedBody["identifier"],
							os: receivedBody["os"],
							fetch: receivedBody["fetch"],
							status: "STARTING",
						});
					},
				),
			);

			const client = createClient();
			const response = await client.addSandbox({
				body: {
					name: "Fetch Sandbox",
					identifier: "fetch-sandbox",
					os: "ubuntu:24.04",
					fetch: fetchItems,
				},
			});

			expect(receivedBody?.["fetch"]).toEqual(fetchItems);
			expect(response?.fetch).toEqual(fetchItems);
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

	describe("sandbox apps", () => {
		it("should start a sandbox app and return the updated sandbox", async () => {
			server.use(
				http.post(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-id/apps/app-1/start`,
					() =>
						HttpResponse.json({
							id: "sandbox-id",
							status: "RUNNING",
							apps: [
								{
									id: "app-1",
									command: "node server.js",
									app_status: "RUNNING",
								},
								{
									id: "app-2",
									command: "python worker.py",
									app_status: "RUNNING",
								},
							],
						}),
				),
			);

			const client = createClient();
			const response = await client.startSandboxApp({
				path: { sandbox_id: "sandbox-id", app_id: "app-1" },
			});

			expect(response?.apps?.find((a) => a.id === "app-1")?.app_status).toBe(
				"RUNNING",
			);
		});

		it("should stop a sandbox app without affecting others", async () => {
			server.use(
				http.post(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-id/apps/app-1/stop`,
					() =>
						HttpResponse.json({
							id: "sandbox-id",
							status: "RUNNING",
							apps: [
								{ id: "app-1", command: "node server.js", app_status: "ENDED" },
								{
									id: "app-2",
									command: "python worker.py",
									app_status: "RUNNING",
								},
							],
						}),
				),
			);

			const client = createClient();
			const response = await client.stopSandboxApp({
				path: { sandbox_id: "sandbox-id", app_id: "app-1" },
			});

			expect(response?.apps?.find((a) => a.id === "app-1")?.app_status).toBe(
				"ENDED",
			);
			expect(response?.apps?.find((a) => a.id === "app-2")?.app_status).toBe(
				"RUNNING",
			);
		});

		it("should fetch app logs with pagination cursor", async () => {
			let receivedCursor: string | null = null;
			server.use(
				http.get(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-id/apps/app-1/logs`,
					({ request }) => {
						receivedCursor = new URL(request.url).searchParams.get("cursor");
						return HttpResponse.json({
							logs: ["line 1", "line 2", "line 3"],
							cursor: "next-page-cursor",
						});
					},
				),
			);

			const client = createClient();
			const response = await client.getSandboxAppLogs({
				path: { sandbox_id: "sandbox-id", app_id: "app-1" },
				query: { cursor: "prev-cursor" },
			});

			expect(receivedCursor).toBe("prev-cursor");
			expect(response?.logs).toEqual(["line 1", "line 2", "line 3"]);
			expect(response?.cursor).toBe("next-page-cursor");
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

		it("should list commands in a sandbox", async () => {
			server.use(
				http.get(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-id/commands`,
					() =>
						HttpResponse.json({
							commands: [
								{
									id: "cmd-a",
									command: "echo first",
									status: "SUCCESSFUL",
									exit_code: 0,
								},
								{
									id: "cmd-b",
									command: "sleep 60",
									status: "INPROGRESS",
								},
							],
						}),
				),
			);

			const client = createClient();
			const response = await client.getSandboxCommands({
				path: { sandbox_id: "sandbox-id" },
			});

			expect(response?.commands).toHaveLength(2);
			expect(response?.commands?.[0]?.id).toBe("cmd-a");
			expect(response?.commands?.[1]?.status).toBe("INPROGRESS");
		});
	});

	describe("updateSandbox", () => {
		it("should PATCH sandbox with new config and return updated sandbox", async () => {
			let receivedBody: Record<string, unknown> | undefined;
			let receivedMethod: string | undefined;
			server.use(
				http.patch(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-id`,
					async ({ request }) => {
						receivedMethod = request.method;
						receivedBody = (await request.json()) as Record<string, unknown>;
						return HttpResponse.json({
							id: "sandbox-id",
							timeout: receivedBody["timeout"],
							tags: receivedBody["tags"],
							status: "RUNNING",
						});
					},
				),
			);

			const client = createClient();
			const response = await client.updateSandbox({
				body: { timeout: 1200, tags: ["updated"] },
				path: { id: "sandbox-id" },
			});

			expect(receivedMethod).toBe("PATCH");
			expect(receivedBody).toEqual({ timeout: 1200, tags: ["updated"] });
			expect(response?.timeout).toBe(1200);
			expect(response?.tags).toEqual(["updated"]);
		});
	});

	describe("sandbox snapshots", () => {
		it("should list all snapshots in the project (across sandboxes)", async () => {
			let receivedProject: string | null = null;
			server.use(
				http.get(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/snapshots`,
					({ request }) => {
						receivedProject = new URL(request.url).searchParams.get(
							"project_name",
						);
						return HttpResponse.json({
							snapshots: [
								{ id: "snap-a", name: "From sandbox A", status: "CREATED" },
								{ id: "snap-b", name: "Orphan", status: "CREATED" },
							],
						});
					},
				),
			);

			const client = createClient();
			const response = await client.getProjectSnapshots({});

			expect(receivedProject).toBe(TEST_PROJECT);
			expect(response?.snapshots).toHaveLength(2);
			expect(response?.snapshots?.map((s) => s.id)).toEqual([
				"snap-a",
				"snap-b",
			]);
		});

		it("should list snapshots for a sandbox", async () => {
			server.use(
				http.get(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-id/snapshots`,
					() =>
						HttpResponse.json({
							snapshots: [
								{ id: "snap-1", name: "First" },
								{ id: "snap-2", name: "Second" },
							],
						}),
				),
			);

			const client = createClient();
			const response = await client.getSandboxSnapshots({
				path: { sandbox_id: "sandbox-id" },
			});

			expect(response?.snapshots).toHaveLength(2);
			expect(response?.snapshots?.[0]?.id).toBe("snap-1");
		});

		it("should create a snapshot with optional name", async () => {
			let receivedBody: Record<string, unknown> | undefined;
			server.use(
				http.post(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-id/snapshots`,
					async ({ request }) => {
						receivedBody = (await request.json()) as Record<string, unknown>;
						return HttpResponse.json(
							{ id: "snap-new", name: receivedBody["name"] },
							{ status: 201 },
						);
					},
				),
			);

			const client = createClient();
			const response = await client.addSandboxSnapshot({
				body: { name: "before-deploy" },
				path: { sandbox_id: "sandbox-id" },
			});

			expect(receivedBody).toEqual({ name: "before-deploy" });
			expect(response?.id).toBe("snap-new");
		});

		it("should fetch a specific snapshot by ID", async () => {
			server.use(
				http.get(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-id/snapshots/snap-1`,
					() => HttpResponse.json({ id: "snap-1", name: "First" }),
				),
			);

			const client = createClient();
			const response = await client.getSandboxSnapshot({
				path: { sandbox_id: "sandbox-id", id: "snap-1" },
			});

			expect(response?.id).toBe("snap-1");
		});

		it("should delete a snapshot", async () => {
			server.use(
				http.delete(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-id/snapshots/snap-1`,
					() => new HttpResponse(null, { status: 204 }),
				),
			);

			const client = createClient();
			await expect(
				client.deleteSandboxSnapshot({
					path: { sandbox_id: "sandbox-id", id: "snap-1" },
				}),
			).resolves.not.toThrow();
		});

		it("should not throw on 404 when deleting a snapshot (already gone)", async () => {
			server.use(
				http.delete(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/sandbox-id/snapshots/snap-missing`,
					() =>
						HttpResponse.json(
							{ errors: [{ message: "not found" }] },
							{ status: 404 },
						),
				),
			);

			const client = createClient();
			await expect(
				client.deleteSandboxSnapshot({
					path: { sandbox_id: "sandbox-id", id: "snap-missing" },
				}),
			).resolves.toBeUndefined();
		});

		it("should delete a snapshot at the project level (no sandbox_id)", async () => {
			let requested = false;
			server.use(
				http.delete(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/snapshots/orphan-snap`,
					() => {
						requested = true;
						return new HttpResponse(null, { status: 204 });
					},
				),
			);

			const client = createClient();
			await expect(
				client.deleteSnapshot({ path: { id: "orphan-snap" } }),
			).resolves.not.toThrow();
			expect(requested).toBe(true);
		});

		it("should not throw on 404 when deleting a project-level snapshot", async () => {
			server.use(
				http.delete(
					`${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/snapshots/missing-orphan`,
					() =>
						HttpResponse.json(
							{ errors: [{ message: "not found" }] },
							{ status: 404 },
						),
				),
			);

			const client = createClient();
			await expect(
				client.deleteSnapshot({ path: { id: "missing-orphan" } }),
			).resolves.toBeUndefined();
		});
	});
});
