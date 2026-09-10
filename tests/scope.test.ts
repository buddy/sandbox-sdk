import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BuddyApiClient, type BuddyApiConfig } from "@/core/buddy-api-client";
import { Sandbox } from "@/entity/sandbox";
import { createClient } from "@/utils/client";

/**
 * Scope matrix for PROJECT / ENVIRONMENT / WORKSPACE sandboxes: which query
 * params go out, what lands in the create body, how many lookups an
 * environment costs. The body assertions need the schema patch from
 * `scripts/cleanup-schemas.ts`, so run `pnpm fetch:schemas` first.
 */

const TEST_API_URL = "https://api.test.buddy.works";
const TEST_WORKSPACE = "test-workspace";
const TEST_PROJECT = "test-project";
const TEST_TOKEN = "test-token";
const ENVIRONMENT = "staging";
const ENVIRONMENT_ID = "3a4KbBQl";

const SANDBOXES_URL = `${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes`;
const SNAPSHOTS_URL = `${SANDBOXES_URL}/snapshots`;
const IDENTIFIERS_URL = `${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/identifiers`;

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const buildClient = (
	scope: Pick<
		BuddyApiConfig,
		"project_name" | "environment" | "environment_id"
	>,
) =>
	new BuddyApiClient({
		workspace: TEST_WORKSPACE,
		token: TEST_TOKEN,
		apiUrl: TEST_API_URL,
		...scope,
	});

/** Capture the query params of every sandbox listing that goes out */
function recordListRequests() {
	const queries: URLSearchParams[] = [];

	server.use(
		http.get(SANDBOXES_URL, ({ request }) => {
			queries.push(new URL(request.url).searchParams);
			return HttpResponse.json({ sandboxes: [] });
		}),
	);

	return queries;
}

/** Resolve `staging` only for the given lookup shape, 404 otherwise */
function resolveEnvironment(options: { inProject?: boolean } = {}) {
	const lookups: URLSearchParams[] = [];

	server.use(
		http.get(IDENTIFIERS_URL, ({ request }) => {
			const query = new URL(request.url).searchParams;
			lookups.push(query);

			const project = query.get("project");
			const askedInProject = project !== null;
			const matches =
				options.inProject === true ? askedInProject : !askedInProject;

			return HttpResponse.json({
				// The endpoint echoes back the project it resolved.
				...(project ? { project_identifier: project } : {}),
				...(matches ? { environment_id: ENVIRONMENT_ID } : {}),
			});
		}),
	);

	return lookups;
}

describe("scope resolution", () => {
	it("pins requests to the project when only a project is configured", async () => {
		const queries = recordListRequests();

		await buildClient({ project_name: TEST_PROJECT }).getSandboxes({});

		expect(queries[0]?.get("project_name")).toBe(TEST_PROJECT);
		expect(queries[0]?.get("environment_id")).toBeNull();
	});

	it("sends no scope params at all when neither is configured", async () => {
		const queries = recordListRequests();

		await buildClient({}).getSandboxes({});

		expect([...(queries[0]?.keys() ?? [])]).toEqual([]);
	});

	it("pins requests to the environment, not the project, when both are given", async () => {
		const lookups = resolveEnvironment({ inProject: true });
		const queries = recordListRequests();

		await buildClient({
			project_name: TEST_PROJECT,
			environment: ENVIRONMENT,
		}).getSandboxes({});

		expect(lookups[0]?.get("project")).toBe(TEST_PROJECT);
		expect(lookups[0]?.get("environment")).toBe(ENVIRONMENT);
		expect(queries[0]?.get("environment_id")).toBe(ENVIRONMENT_ID);
		expect(queries[0]?.get("project_name")).toBeNull();
	});

	it("stays in the project instead of looking one level up", async () => {
		const lookups = resolveEnvironment({ inProject: false });

		await expect(
			buildClient({
				project_name: TEST_PROJECT,
				environment: ENVIRONMENT,
			}).getSandboxes({}),
		).rejects.toThrow(
			`Environment '${ENVIRONMENT}' not found in project '${TEST_PROJECT}'.`,
		);

		expect(lookups).toHaveLength(1);
	});

	it("resolves the environment once and reuses it", async () => {
		const lookups = resolveEnvironment();
		recordListRequests();

		const client = buildClient({ environment: ENVIRONMENT });
		await client.getSandboxes({});
		await client.getSandboxes({});
		await client.getSandboxes({});

		expect(lookups).toHaveLength(1);
	});

	it("retries the lookup after a failure instead of caching it", async () => {
		let attempt = 0;

		server.use(
			http.get(IDENTIFIERS_URL, () => {
				attempt += 1;
				// First call comes back empty, the next one resolves.
				return attempt === 1
					? HttpResponse.json({})
					: HttpResponse.json({ environment_id: ENVIRONMENT_ID });
			}),
		);
		const queries = recordListRequests();

		const client = buildClient({ environment: ENVIRONMENT });

		await expect(client.getSandboxes({})).rejects.toThrow(
			`Environment '${ENVIRONMENT}' not found`,
		);
		await client.getSandboxes({});

		expect(queries[0]?.get("environment_id")).toBe(ENVIRONMENT_ID);
	});

	it("skips the lookup entirely when the environment ID is known upfront", async () => {
		const queries = recordListRequests();

		await buildClient({ environment_id: ENVIRONMENT_ID }).getSandboxes({});

		expect(queries[0]?.get("environment_id")).toBe(ENVIRONMENT_ID);
	});

	it("reports an unknown project instead of quietly using a workspace environment", async () => {
		// No project_identifier in the response means the project did not
		// resolve - the environment_id then answers a different question.
		server.use(
			http.get(IDENTIFIERS_URL, () =>
				HttpResponse.json({ environment_id: ENVIRONMENT_ID }),
			),
		);

		await expect(
			buildClient({
				project_name: TEST_PROJECT,
				environment: ENVIRONMENT,
			}).getSandboxes({}),
		).rejects.toThrow(`Project '${TEST_PROJECT}' not found.`);
	});

	it("points at the project when no environment was given and none is found", async () => {
		server.use(http.get(IDENTIFIERS_URL, () => HttpResponse.json({})));

		await expect(
			buildClient({ environment: ENVIRONMENT }).getSandboxes({}),
		).rejects.toThrow(
			`Environment '${ENVIRONMENT}' not found at workspace level.`,
		);
	});
});

describe("snapshot listing", () => {
	/** Capture the query params of every project-snapshot listing */
	function recordSnapshotRequests() {
		const queries: URLSearchParams[] = [];

		server.use(
			http.get(SNAPSHOTS_URL, ({ request }) => {
				queries.push(new URL(request.url).searchParams);
				return HttpResponse.json({ snapshots: [] });
			}),
		);

		return queries;
	}

	it("follows the project scope", async () => {
		const queries = recordSnapshotRequests();

		await buildClient({ project_name: TEST_PROJECT }).getProjectSnapshots({});

		expect(queries[0]?.get("project_name")).toBe(TEST_PROJECT);
	});

	it("follows the environment scope", async () => {
		resolveEnvironment();
		const queries = recordSnapshotRequests();

		await buildClient({ environment: ENVIRONMENT }).getProjectSnapshots({});

		expect(queries[0]?.get("environment_id")).toBe(ENVIRONMENT_ID);
		expect(queries[0]?.get("project_name")).toBeNull();
	});

	it("asks for workspace-level snapshots when nothing is configured", async () => {
		const queries = recordSnapshotRequests();

		await buildClient({}).getProjectSnapshots({});

		expect([...(queries[0]?.keys() ?? [])]).toEqual([]);
	});
});

describe("file upload", () => {
	it("no longer tags the request with a project", async () => {
		let uploadQuery: URLSearchParams | undefined;

		server.use(
			http.post(
				`${SANDBOXES_URL}/sandbox-1/content/upload/hello.txt`,
				({ request }) => {
					uploadQuery = new URL(request.url).searchParams;
					return HttpResponse.json({
						type: "FILE",
						name: "hello.txt",
						path: "hello.txt",
					});
				},
			),
		);

		// project_name is not a parameter of this endpoint - the backend ignored
		// it, and outside a project there is nothing to send anyway.
		await buildClient({ project_name: TEST_PROJECT }).uploadSandboxFile({
			body: new Blob(["hello"]),
			path: { sandbox_id: "sandbox-1", path: "hello.txt" },
		});

		expect([...(uploadQuery?.keys() ?? [])]).toEqual([]);
	});
});

describe("scope in the create body", () => {
	it("attaches the environment reference for environment-scoped sandboxes", async () => {
		resolveEnvironment();
		let body: Record<string, unknown> | undefined;

		server.use(
			http.post(SANDBOXES_URL, async ({ request }) => {
				body = (await request.json()) as Record<string, unknown>;
				return HttpResponse.json({ id: "sandbox-1" }, { status: 201 });
			}),
		);

		await buildClient({ environment: ENVIRONMENT }).addSandbox({
			body: { name: "New sandbox", os: "ubuntu:24.04" },
		});

		expect(body?.["scope"]).toBe("ENVIRONMENT");
		expect(body?.["environment"]).toEqual({ id: ENVIRONMENT_ID });
	});

	it("leaves the body untouched for project-scoped sandboxes", async () => {
		let body: Record<string, unknown> | undefined;

		server.use(
			http.post(SANDBOXES_URL, async ({ request }) => {
				body = (await request.json()) as Record<string, unknown>;
				return HttpResponse.json({ id: "sandbox-1" }, { status: 201 });
			}),
		);

		await buildClient({ project_name: TEST_PROJECT }).addSandbox({
			body: { name: "New sandbox", os: "ubuntu:24.04" },
		});

		expect(body).toEqual({ name: "New sandbox", os: "ubuntu:24.04" });
	});
});

describe("Sandbox.getByIdentifier", () => {
	const connection = {
		workspace: TEST_WORKSPACE,
		token: TEST_TOKEN,
		apiUrl: TEST_API_URL,
	};

	it("resolves through /identifiers when scoped to a project", async () => {
		let usedIdentifiers = false;

		server.use(
			http.get(IDENTIFIERS_URL, () => {
				usedIdentifiers = true;
				return HttpResponse.json({ sandbox_id: "sandbox-1" });
			}),
			http.get(`${SANDBOXES_URL}/sandbox-1`, () =>
				HttpResponse.json({ id: "sandbox-1", identifier: "my_sandbox" }),
			),
		);

		const sandbox = await Sandbox.getByIdentifier("my_sandbox", {
			connection: { ...connection, project: TEST_PROJECT },
		});

		expect(usedIdentifiers).toBe(true);
		expect(sandbox.data.id).toBe("sandbox-1");
	});

	it("matches against the listing when the sandbox lives outside a project", async () => {
		server.use(
			http.get(SANDBOXES_URL, () =>
				HttpResponse.json({
					sandboxes: [
						{ id: "sandbox-1", identifier: "other" },
						{ id: "sandbox-2", identifier: "my_sandbox" },
					],
				}),
			),
			http.get(`${SANDBOXES_URL}/sandbox-2`, () =>
				HttpResponse.json({ id: "sandbox-2", identifier: "my_sandbox" }),
			),
		);

		const sandbox = await Sandbox.getByIdentifier("my_sandbox", {
			connection,
		});

		expect(sandbox.data.id).toBe("sandbox-2");
	});

	it("reports a missing identifier instead of guessing", async () => {
		server.use(
			http.get(SANDBOXES_URL, () => HttpResponse.json({ sandboxes: [] })),
		);

		await expect(
			Sandbox.getByIdentifier("ghost", { connection }),
		).rejects.toThrow("Sandbox with identifier 'ghost' not found");
	});
});

describe("connection config", () => {
	const withEnv = async (
		vars: Record<string, string | undefined>,
		run: () => Promise<void> | void,
	) => {
		const previous = new Map(
			Object.keys(vars).map((key) => [key, process.env[key]]),
		);

		for (const [key, value] of Object.entries(vars)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}

		try {
			await run();
		} finally {
			for (const [key, value] of previous) {
				if (value === undefined) {
					delete process.env[key];
				} else {
					process.env[key] = value;
				}
			}
		}
	};

	it("takes the scope from env vars when the caller says nothing", async () => {
		await withEnv(
			{
				BUDDY_WORKSPACE: TEST_WORKSPACE,
				BUDDY_API_URL: TEST_API_URL,
				BUDDY_TOKEN: TEST_TOKEN,
				BUDDY_PROJECT: TEST_PROJECT,
				BUDDY_ENVIRONMENT: undefined,
			},
			() => {
				expect(createClient().scope).toBe("PROJECT");
			},
		);
	});

	it("lets an explicit project override a globally set environment", async () => {
		await withEnv(
			{
				BUDDY_WORKSPACE: TEST_WORKSPACE,
				BUDDY_API_URL: TEST_API_URL,
				BUDDY_TOKEN: TEST_TOKEN,
				BUDDY_ENVIRONMENT: ENVIRONMENT,
			},
			() => {
				expect(createClient({ project: TEST_PROJECT }).scope).toBe("PROJECT");
			},
		);
	});

	it("lets an explicit environment override a globally set project", async () => {
		await withEnv(
			{
				BUDDY_WORKSPACE: TEST_WORKSPACE,
				BUDDY_API_URL: TEST_API_URL,
				BUDDY_TOKEN: TEST_TOKEN,
				BUDDY_PROJECT: TEST_PROJECT,
			},
			() => {
				const client = createClient({ environment: ENVIRONMENT });

				expect(client.scope).toBe("ENVIRONMENT");
				expect(client.project_name).toBeUndefined();
			},
		);
	});

	it("prefers the environment when both env vars are set", async () => {
		// The .env of this repo sets both: a project for everyday work and an
		// environment for the scope tests. Whichever way that resolves, it has
		// to be deliberate rather than incidental.
		await withEnv(
			{
				BUDDY_WORKSPACE: TEST_WORKSPACE,
				BUDDY_API_URL: TEST_API_URL,
				BUDDY_TOKEN: TEST_TOKEN,
				BUDDY_PROJECT: TEST_PROJECT,
				BUDDY_ENVIRONMENT: ENVIRONMENT,
			},
			() => {
				const client = createClient();

				expect(client.scope).toBe("ENVIRONMENT");
				// The project stays around: a project-scoped environment can only
				// be looked up through it.
				expect(client.project_name).toBe(TEST_PROJECT);
			},
		);
	});

	it("keeps the project for the lookup when the caller passes both", async () => {
		await withEnv(
			{
				BUDDY_WORKSPACE: TEST_WORKSPACE,
				BUDDY_API_URL: TEST_API_URL,
				BUDDY_TOKEN: TEST_TOKEN,
			},
			() => {
				const client = createClient({
					project: TEST_PROJECT,
					environment: ENVIRONMENT,
				});

				expect(client.scope).toBe("ENVIRONMENT");
				expect(client.project_name).toBe(TEST_PROJECT);
			},
		);
	});

	it("states workspace placement by naming only the workspace", async () => {
		await withEnv(
			{
				BUDDY_WORKSPACE: TEST_WORKSPACE,
				BUDDY_API_URL: TEST_API_URL,
				BUDDY_TOKEN: TEST_TOKEN,
				BUDDY_PROJECT: TEST_PROJECT,
			},
			() => {
				expect(createClient({ workspace: TEST_WORKSPACE }).scope).toBe(
					"WORKSPACE",
				);
			},
		);
	});

	it("falls back to workspace scope when nothing is configured", async () => {
		await withEnv(
			{
				BUDDY_WORKSPACE: TEST_WORKSPACE,
				BUDDY_API_URL: TEST_API_URL,
				BUDDY_TOKEN: TEST_TOKEN,
				BUDDY_PROJECT: undefined,
				BUDDY_ENVIRONMENT: undefined,
			},
			() => {
				expect(createClient().scope).toBe("WORKSPACE");
			},
		);
	});
});
