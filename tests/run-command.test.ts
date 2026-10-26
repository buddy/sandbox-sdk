import { Writable } from "node:stream";
import { delay, HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { Sandbox } from "@/entity/sandbox";
import { BuddySDKError, ERROR_CODES } from "@/errors";
import logger from "@/utils/logger";

const TEST_API_URL = "https://api.test.buddy.works";
const TEST_WORKSPACE = "test-workspace";
const SANDBOX_ID = "sandbox-123";
const EXEC_ID = "exec-123";

const connection = {
	workspace: TEST_WORKSPACE,
	project: "test-project",
	token: "test-token",
	apiUrl: TEST_API_URL,
};

const SANDBOX_URL = `${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes/${SANDBOX_ID}`;
const EXEC_URL = `${SANDBOX_URL}/execs/${EXEC_ID}`;

const server = setupServer();

// msw intercepts fetch, not node:http2
vi.stubEnv("BUDDY_HTTP2", "0");

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const exec = (status: string, extra: Record<string, unknown> = {}) => ({
	execution_id: EXEC_ID,
	command: "echo one && echo two >&2",
	status,
	...extra,
});

/** The sandbox the instance is built from, and a command it accepts */
const stubSandbox = () =>
	server.use(
		http.get(SANDBOX_URL, () =>
			HttpResponse.json({ id: SANDBOX_ID, status: "RUNNING" }),
		),
		http.post(`${SANDBOX_URL}/execs`, () =>
			HttpResponse.json(exec("INPROGRESS")),
		),
	);

/** Answer status requests in turn, repeating the last answer */
const stubStatuses = (...statuses: Record<string, unknown>[]) => {
	const waits: (string | null)[] = [];
	server.use(
		http.get(EXEC_URL, ({ request }) => {
			waits.push(new URL(request.url).searchParams.get("wait"));
			return HttpResponse.json(
				statuses[Math.min(waits.length - 1, statuses.length - 1)],
			);
		}),
	);
	return waits;
};

/** Serve the log from `lines`, as much of it as has been written */
const stubLog = (lines: string[], written: () => number) => {
	const offsets: number[] = [];
	server.use(
		http.get(`${EXEC_URL}/log`, ({ request }) => {
			const params = new URL(request.url).searchParams;
			const offset = Number(params.get("offset"));
			const limit = Number(params.get("limit"));
			offsets.push(offset);
			const slice = lines.slice(offset, Math.min(offset + limit, written()));
			return HttpResponse.json({
				execution_id: EXEC_ID,
				lines: slice,
				next_offset: offset + slice.length,
				truncated: false,
			});
		}),
	);
	return offsets;
};

const collect = () => {
	let text = "";
	const stream = new Writable({
		write(chunk, _encoding, callback) {
			text += String(chunk);
			callback();
		},
	});
	return { stream, text: () => text };
};

/** A signal that aborts shortly, like a deadline that has run out */
const abortSoon = () => {
	const controller = new AbortController();
	setTimeout(
		() => controller.abort(new DOMException("Timed out", "TimeoutError")),
		50,
	);
	return controller.signal;
};

describe("Sandbox.runCommand", () => {
	it("streams the log until the command finishes", async () => {
		stubSandbox();
		// The second line lands once the command has finished
		let finished = false;
		const waits: (string | null)[] = [];
		const offsets = stubLog(["one", "two"], () => (finished ? 2 : 1));
		server.use(
			http.get(EXEC_URL, ({ request }) => {
				waits.push(new URL(request.url).searchParams.get("wait"));
				finished = true;
				return HttpResponse.json(exec("SUCCESSFUL", { exit_code: 0 }));
			}),
		);
		const output = collect();

		const sandbox = await Sandbox.getById(SANDBOX_ID, { connection });
		const command = await sandbox.runCommand({
			command: "echo one && echo two >&2",
			output: output.stream,
		});

		expect(output.text()).toBe("one\ntwo\n");
		expect(offsets).toEqual([0, 1]);
		expect(waits).toEqual(["1000", "25000"]);
		expect(command.data.status).toBe("SUCCESSFUL");
		expect(command.data.exit_code).toBe(0);
	});

	it("returns a detached command right away", async () => {
		stubSandbox();

		const sandbox = await Sandbox.getById(SANDBOX_ID, { connection });
		const command = await sandbox.runCommand({
			command: "sleep 60",
			output: null,
			detached: true,
		});

		expect(command.id).toBe(EXEC_ID);
		expect(command.data.status).toBe("INPROGRESS");
	});

	it("rejects the stdout and stderr options it no longer takes", async () => {
		stubSandbox();
		let started = false;
		server.use(
			http.post(`${SANDBOX_URL}/execs`, () => {
				started = true;
				return HttpResponse.json(exec("INPROGRESS"));
			}),
		);

		const sandbox = await Sandbox.getById(SANDBOX_ID, { connection });
		const legacy = { command: "env", stdout: null } as never;

		await expect(sandbox.runCommand(legacy)).rejects.toThrow(
			"`output` in place of `stdout` and `stderr`",
		);
		expect(started).toBe(false);
	});

	it("reports a failed background stream instead of crashing", async () => {
		stubSandbox();
		server.use(
			http.get(`${EXEC_URL}/log`, () =>
				HttpResponse.json({ errors: [{ message: "gone" }] }, { status: 404 }),
			),
		);
		const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

		const sandbox = await Sandbox.getById(SANDBOX_ID, { connection });
		await sandbox.runCommand({
			command: "echo one",
			output: collect().stream,
			detached: true,
		});

		await vi.waitFor(() =>
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining(EXEC_ID),
				expect.anything(),
			),
		);
		warn.mockRestore();
	});

	it("reports the concurrency limit without running the command twice", async () => {
		const message =
			"Concurrency limit reached: at most 3 parallel executions are allowed for this target";
		let attempts = 0;
		server.use(
			http.get(SANDBOX_URL, () =>
				HttpResponse.json({ id: SANDBOX_ID, status: "RUNNING" }),
			),
			http.post(`${SANDBOX_URL}/execs`, () => {
				attempts++;
				return HttpResponse.json({ errors: [{ message }] }, { status: 409 });
			}),
		);

		const sandbox = await Sandbox.getById(SANDBOX_ID, { connection });
		const error = await sandbox
			.runCommand({ command: "sleep 60", output: null, detached: true })
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(BuddySDKError);
		expect(error).toMatchObject({
			code: ERROR_CODES.HTTP_ERROR,
			statusCode: 409,
		});
		expect((error as BuddySDKError).message).toContain(message);
		expect(attempts).toBe(1);
	});
});

describe("Command", () => {
	const detached = async () => {
		const sandbox = await Sandbox.getById(SANDBOX_ID, { connection });
		return sandbox.runCommand({
			command: "echo one && echo two >&2",
			output: null,
			detached: true,
		});
	};

	it("reads the log page by page without following", async () => {
		stubSandbox();
		const lines = Array.from({ length: 1500 }, (_, i) => `line ${i}`);
		const offsets = stubLog(lines, () => lines.length);

		const command = await detached();
		const read: string[] = [];
		for await (const line of command.logs()) read.push(line);

		expect(read).toEqual(lines);
		expect(offsets).toEqual([0, 1000]);
	});

	it("warns once when the API truncated the log", async () => {
		stubSandbox();
		// Two pages, both flagged
		const lines = Array.from({ length: 1001 }, (_, i) => `line ${i}`);
		server.use(
			http.get(`${EXEC_URL}/log`, ({ request }) => {
				const offset = Number(new URL(request.url).searchParams.get("offset"));
				const slice = lines.slice(offset, offset + 1000);
				return HttpResponse.json({
					lines: slice,
					next_offset: offset + slice.length,
					truncated: true,
				});
			}),
		);
		const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

		const command = await detached();
		const read: string[] = [];
		for await (const line of command.logs()) read.push(line);

		expect(read).toEqual(lines);
		expect(warn).toHaveBeenCalledOnce();
		expect(warn).toHaveBeenCalledWith(
			`The log of command ${EXEC_ID} is truncated`,
		);
		warn.mockRestore();
	});

	it("holds status requests longer while the log stays quiet", async () => {
		stubSandbox();
		// A line lands after the second status check, then the command finishes
		const waits: (string | null)[] = [];
		server.use(
			http.get(EXEC_URL, ({ request }) => {
				waits.push(new URL(request.url).searchParams.get("wait"));
				return HttpResponse.json(
					exec(waits.length < 3 ? "INPROGRESS" : "SUCCESSFUL"),
				);
			}),
		);
		stubLog(["late"], () => (waits.length >= 2 ? 1 : 0));

		const command = await detached();
		const read: string[] = [];
		for await (const line of command.logs({ follow: true })) read.push(line);

		expect(read).toEqual(["late"]);
		expect(waits).toEqual(["1000", "1500", "1000"]);
	});

	it("does not ask the API again about a finished command", async () => {
		stubSandbox();
		server.use(
			http.get(`${SANDBOX_URL}/execs`, () =>
				HttpResponse.json([exec("SUCCESSFUL", { exit_code: 0 })]),
			),
		);

		// No status handler: a request would fail the test
		const sandbox = await Sandbox.getById(SANDBOX_ID, { connection });
		const [command] = await sandbox.listCommands();
		const finished = await command?.wait();

		expect(finished?.data.exit_code).toBe(0);
	});

	it("pads status answers the API did not hold", async () => {
		stubSandbox();
		const waits = stubStatuses(
			exec("INPROGRESS"),
			exec("INPROGRESS"),
			exec("FAILED", { exit_code: 3 }),
		);

		const command = await detached();
		const startedAt = Date.now();
		const finished = await command.wait();

		expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1900);
		expect(waits).toEqual(["25000", "25000", "25000"]);
		expect(finished.data.status).toBe("FAILED");
		expect(finished.data.exit_code).toBe(3);
	});

	it("keeps waiting while the status is missing", async () => {
		stubSandbox();
		const waits = stubStatuses(
			{ execution_id: EXEC_ID },
			exec("SUCCESSFUL", { exit_code: 0 }),
		);

		const command = await detached();
		const finished = await command.wait();

		expect(waits).toHaveLength(2);
		expect(finished.data.exit_code).toBe(0);
	});

	it("treats any status but INPROGRESS as final", async () => {
		stubSandbox();
		stubStatuses(exec("SOMETHING_NEW"));

		const command = await detached();
		const finished = await command.wait();

		expect(finished.data.status).toBe("SOMETHING_NEW");
	});

	it("cancels the command and waits until it has stopped", async () => {
		stubSandbox();
		let cancelled = false;
		server.use(
			http.delete(EXEC_URL, () => {
				cancelled = true;
				return new HttpResponse(null, { status: 204 });
			}),
			http.get(EXEC_URL, () =>
				HttpResponse.json(exec(cancelled ? "CANCELLED" : "INPROGRESS")),
			),
		);

		const command = await detached();
		await command.kill();
		const finished = await command.wait();

		expect(cancelled).toBe(true);
		expect(finished.data.status).toBe("CANCELLED");
	});

	it("stops waiting for a command that does not stop after kill()", async () => {
		stubSandbox();
		server.use(
			http.delete(EXEC_URL, () => new HttpResponse(null, { status: 204 })),
			http.get(EXEC_URL, () => HttpResponse.json(exec("INPROGRESS"))),
		);
		// Stand in for the 30s deadline with a short one
		const timeout = vi
			.spyOn(AbortSignal, "timeout")
			.mockImplementation(() => abortSoon());

		const command = await detached();
		await expect(command.kill()).resolves.toBeUndefined();

		expect(timeout).toHaveBeenCalledWith(30_000);
		timeout.mockRestore();
	});

	it("gives up waiting when the signal aborts, mid long-poll", async () => {
		stubSandbox();
		let requests = 0;
		server.use(
			http.get(EXEC_URL, async () => {
				requests++;
				await delay("infinite");
				return HttpResponse.json(exec("INPROGRESS"));
			}),
		);

		const command = await detached();
		const controller = new AbortController();
		const reason = new Error("deadline");
		setTimeout(() => controller.abort(reason), 50);

		await expect(command.wait({ signal: controller.signal })).rejects.toBe(
			reason,
		);
		expect(requests).toBe(1);
	});

	it("stops following the log when the signal aborts", async () => {
		stubSandbox();
		stubStatuses(exec("INPROGRESS"));
		stubLog(["one"], () => 1);

		const command = await detached();
		const controller = new AbortController();
		const read: string[] = [];

		await expect(
			(async () => {
				for await (const line of command.logs({
					follow: true,
					signal: controller.signal,
				})) {
					read.push(line);
					controller.abort();
				}
			})(),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(read).toEqual(["one"]);
	});
});

describe("Sandbox.listCommands", () => {
	it("asks for the whole history the API keeps", async () => {
		stubSandbox();
		let limit: string | null = null;
		server.use(
			http.get(`${SANDBOX_URL}/execs`, ({ request }) => {
				limit = new URL(request.url).searchParams.get("limit");
				return HttpResponse.json([
					exec("SUCCESSFUL"),
					{ ...exec("FAILED"), execution_id: "exec-older" },
				]);
			}),
		);

		const sandbox = await Sandbox.getById(SANDBOX_ID, { connection });
		const commands = await sandbox.listCommands();

		expect(limit).toBe("200");
		expect(commands.map((c) => c.id)).toEqual([EXEC_ID, "exec-older"]);
	});

	it("passes a smaller limit through", async () => {
		stubSandbox();
		let limit: string | null = null;
		server.use(
			http.get(`${SANDBOX_URL}/execs`, ({ request }) => {
				limit = new URL(request.url).searchParams.get("limit");
				return HttpResponse.json([exec("SUCCESSFUL")]);
			}),
		);

		const sandbox = await Sandbox.getById(SANDBOX_ID, { connection });
		await sandbox.listCommands({ limit: 5 });

		expect(limit).toBe("5");
	});

	it.each([0, 2.5, 201])("rejects a limit of %s", async (limit) => {
		stubSandbox();

		const sandbox = await Sandbox.getById(SANDBOX_ID, { connection });

		await expect(sandbox.listCommands({ limit })).rejects.toThrow(
			"limit must be a whole number from 1 to 200",
		);
	});
});
