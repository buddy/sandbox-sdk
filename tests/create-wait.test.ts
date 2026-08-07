import { HttpResponse, http } from "msw";
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

const TEST_API_URL = "https://api.test.buddy.works";
const TEST_WORKSPACE = "test-workspace";
const SANDBOX_ID = "sandbox-123";

const connection = {
	workspace: TEST_WORKSPACE,
	project: "test-project",
	token: "test-token",
	apiUrl: TEST_API_URL,
};

const SANDBOX_URL = `${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes`;

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
	server.resetHandlers();
	vi.restoreAllMocks();
});
afterAll(() => server.close());

/** HttpClient's per-request abort timer, which also goes through setTimeout */
const HTTP_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Record the sleeps the polling loop schedules, ignoring the request-abort
 * timers the HTTP client sets around every call.
 */
function recordPollDelays(): number[] {
	const delays: number[] = [];
	const scheduleTimeout = globalThis.setTimeout;

	vi.spyOn(globalThis, "setTimeout").mockImplementation(((
		callback: () => void,
		ms?: number,
	) => {
		if (ms !== HTTP_REQUEST_TIMEOUT_MS) {
			delays.push(ms ?? 0);
		}
		return scheduleTimeout(callback, ms);
	}) as typeof setTimeout);

	return delays;
}

/** Keep the sandbox un-ready for `count` polls, then report it ready */
function notReadyFor(count: number) {
	return [
		...Array.from({ length: count }, () => ({
			setup_status: "INPROGRESS",
			status: "STARTING",
		})),
		{ setup_status: "SUCCESS", status: "RUNNING" },
	];
}

/**
 * Serve a POST /sandboxes that always reports STARTING, then walk
 * GET /sandboxes/:id through the supplied states one call at a time,
 * repeating the last state once exhausted.
 */
function mockSandboxLifecycle(
	states: { setup_status: string; status: string }[],
) {
	const requestedBodies: Record<string, unknown>[] = [];
	let getCount = 0;

	server.use(
		http.post(SANDBOX_URL, async ({ request }) => {
			requestedBodies.push((await request.json()) as Record<string, unknown>);
			return HttpResponse.json({
				id: SANDBOX_ID,
				name: "Test Sandbox",
				os: "ubuntu:24.04",
				setup_status: "INPROGRESS",
				status: "STARTING",
			});
		}),
		http.get(`${SANDBOX_URL}/${SANDBOX_ID}`, () => {
			const state = states[Math.min(getCount, states.length - 1)];
			getCount += 1;
			return HttpResponse.json({
				id: SANDBOX_ID,
				name: "Test Sandbox",
				os: "ubuntu:24.04",
				...state,
			});
		}),
	);

	return {
		requestedBodies,
		getCount: () => getCount,
	};
}

describe("Sandbox.create readiness", () => {
	it("issues a single GET per poll while waiting for both fields", async () => {
		const lifecycle = mockSandboxLifecycle([
			{ setup_status: "INPROGRESS", status: "STARTING" },
			{ setup_status: "SUCCESS", status: "STARTING" },
			{ setup_status: "SUCCESS", status: "RUNNING" },
		]);

		const sandbox = await Sandbox.create({ connection });

		expect(sandbox.data.status).toBe("RUNNING");
		expect(sandbox.data.setup_status).toBe("SUCCESS");
		expect(lifecycle.getCount()).toBe(3);
	});

	it("returns as soon as the first poll sees a ready sandbox", async () => {
		const lifecycle = mockSandboxLifecycle([
			{ setup_status: "SUCCESS", status: "RUNNING" },
		]);

		const started = Date.now();
		await Sandbox.create({ connection });
		const elapsed = Date.now() - started;

		expect(lifecycle.getCount()).toBe(1);
		expect(elapsed).toBeLessThan(100);
	});

	it("backs off from 100ms while waiting", async () => {
		const delays = recordPollDelays();
		mockSandboxLifecycle(notReadyFor(3));

		await Sandbox.create({ connection });

		expect(delays).toEqual([100, 150, 225]);
	});

	it("caps the create backoff at 500ms", async () => {
		const delays = recordPollDelays();
		mockSandboxLifecycle(notReadyFor(8));

		await Sandbox.create({ connection });

		expect(delays.map(Math.round)).toEqual([
			100, 150, 225, 338, 500, 500, 500, 500,
		]);
		expect(Math.max(...delays)).toBe(500);
	});

	it("skips polling entirely when wait is false", async () => {
		const lifecycle = mockSandboxLifecycle([
			{ setup_status: "INPROGRESS", status: "STARTING" },
		]);

		const sandbox = await Sandbox.create({ connection, wait: false });

		expect(sandbox.data.id).toBe(SANDBOX_ID);
		expect(lifecycle.getCount()).toBe(0);
	});

	it("does not forward wait to the API request body", async () => {
		const lifecycle = mockSandboxLifecycle([
			{ setup_status: "SUCCESS", status: "RUNNING" },
		]);

		await Sandbox.create({ connection, wait: false, name: "Named Sandbox" });

		expect(lifecycle.requestedBodies).toHaveLength(1);
		expect(lifecycle.requestedBodies[0]).not.toHaveProperty("wait");
		expect(lifecycle.requestedBodies[0]).toMatchObject({
			name: "Named Sandbox",
		});
	});

	it("surfaces boot logs when setup fails", async () => {
		mockSandboxLifecycle([
			{ setup_status: "INPROGRESS", status: "STARTING" },
			{ setup_status: "FAILED", status: "STARTING" },
		]);

		await expect(Sandbox.create({ connection })).rejects.toThrow(
			`Sandbox ${SANDBOX_ID} setup failed.`,
		);
	});

	it("reports a stale setup", async () => {
		mockSandboxLifecycle([{ setup_status: "STALE", status: "STARTING" }]);

		await expect(Sandbox.create({ connection })).rejects.toThrow(
			"setup is stale",
		);
	});

	it("fails fast when the sandbox reports FAILED", async () => {
		mockSandboxLifecycle([{ setup_status: "INPROGRESS", status: "FAILED" }]);

		await expect(Sandbox.create({ connection })).rejects.toThrow(
			`Sandbox ${SANDBOX_ID} failed.`,
		);
	});
});
