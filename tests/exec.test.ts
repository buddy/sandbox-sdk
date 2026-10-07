import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Sandbox } from "@/entity/sandbox";

const TEST_API_URL = "https://api.test.buddy.works";
const TEST_WORKSPACE = "test-workspace";
const SANDBOX_ID = "sandbox-123";

const connection = {
	workspace: TEST_WORKSPACE,
	project: "test-project",
	token: "test-token",
	apiUrl: TEST_API_URL,
};

const SANDBOX_URL = `${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/${SANDBOX_ID}`;

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** The sandbox the instance is built from */
const stubSandbox = () =>
	server.use(
		http.get(SANDBOX_URL, () =>
			HttpResponse.json({ id: SANDBOX_ID, status: "RUNNING" }),
		),
	);

describe("Sandbox.exec", () => {
	it("returns the result of the command", async () => {
		stubSandbox();
		let body: Record<string, unknown> | undefined;

		server.use(
			http.post(`${SANDBOX_URL}/exec`, async ({ request }) => {
				body = (await request.json()) as Record<string, unknown>;
				return HttpResponse.json({
					command: "npm test",
					runtime: "BASH",
					exit_code: 0,
					stdout: "All tests passed\n",
					stderr: "",
				});
			}),
		);

		const sandbox = await Sandbox.getById(SANDBOX_ID, { connection });
		const result = await sandbox.exec({ command: "npm test" });

		expect(body).toEqual({ command: "npm test" });
		expect(result.exit_code).toBe(0);
		expect(result.stdout).toBe("All tests passed\n");
		expect(result.stderr).toBe("");
	});

	it("passes the runtime through and reports a failing exit code", async () => {
		stubSandbox();
		let body: Record<string, unknown> | undefined;

		server.use(
			http.post(`${SANDBOX_URL}/exec`, async ({ request }) => {
				body = (await request.json()) as Record<string, unknown>;
				return HttpResponse.json({
					command: "import sys; sys.exit(2)",
					runtime: "PYTHON",
					exit_code: 2,
					stdout: "",
					stderr: "boom\n",
				});
			}),
		);

		const sandbox = await Sandbox.getById(SANDBOX_ID, { connection });
		const result = await sandbox.exec({
			command: "import sys; sys.exit(2)",
			runtime: "PYTHON",
		});

		expect(body).toEqual({
			command: "import sys; sys.exit(2)",
			runtime: "PYTHON",
		});
		// A non-zero exit is a result, not an error - the caller decides.
		expect(result.exit_code).toBe(2);
		expect(result.stderr).toBe("boom\n");
	});

	it("gives up on its own deadline rather than the client-wide one", async () => {
		stubSandbox();

		server.use(
			http.post(`${SANDBOX_URL}/exec`, async () => {
				await new Promise((resolve) => setTimeout(resolve, 200));
				return HttpResponse.json({ exit_code: 0 });
			}),
		);

		const sandbox = await Sandbox.getById(SANDBOX_ID, { connection });

		await expect(
			sandbox.exec({ command: "sleep 10", timeoutMs: 50 }),
		).rejects.toThrow();
	});

	it("does not re-run a command after an ambiguous failure", async () => {
		stubSandbox();
		let attempts = 0;

		server.use(
			http.post(`${SANDBOX_URL}/exec`, () => {
				attempts += 1;
				return HttpResponse.error();
			}),
		);

		const sandbox = await Sandbox.getById(SANDBOX_ID, { connection });

		await expect(sandbox.exec({ command: "deploy" })).rejects.toThrow();
		expect(attempts).toBe(1);
	});
});
