import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Sandbox } from "@/entity/sandbox";

/**
 * Empirical tests for `sandbox.update()` — probe how the backend actually
 * reacts to PATCH on each field of UpdateSandboxRequestWritable. Each test
 * captures `setup_status` and `status` before/after the update and logs them,
 * so running this suite tells us which fields apply in place and which
 * destabilise the sandbox.
 *
 * Run with `pnpm test tests/update-behavior.test.ts` once `.env` has live
 * BUDDY_TOKEN / BUDDY_WORKSPACE / BUDDY_PROJECT.
 */

const logFieldEffect = (
	label: string,
	before: { setup: string | undefined; status: string | undefined },
	after: { setup: string | undefined; status: string | undefined },
) => {
	console.log(
		`[update:${label}] setup_status ${before.setup} -> ${after.setup} | status ${before.status} -> ${after.status}`,
	);
};

describe("Sandbox.update — soft fields (shared sandbox)", () => {
	let sandbox: Sandbox;

	beforeAll(async () => {
		sandbox = await Sandbox.create({
			name: `update-probe-${Date.now()}`,
			identifier: `update_probe_${Date.now()}`,
			timeout: 600,
			tags: ["initial"],
			apps: ["echo initial-app"],
			first_boot_commands: "echo initial-first-boot",
		});
	}, 120_000);

	afterAll(async () => {
		await sandbox?.destroy().catch(() => undefined);
	}, 60_000);

	it("updates timeout in place", async () => {
		const before = {
			setup: sandbox.data.setup_status,
			status: sandbox.data.status,
		};
		await sandbox.update({ timeout: 1800 });
		const after = {
			setup: sandbox.data.setup_status,
			status: sandbox.data.status,
		};
		logFieldEffect("timeout", before, after);

		expect(sandbox.data.timeout).toBe(1800);
	});

	it("updates tags in place", async () => {
		const before = {
			setup: sandbox.data.setup_status,
			status: sandbox.data.status,
		};
		await sandbox.update({ tags: ["probed", "updated"] });
		const after = {
			setup: sandbox.data.setup_status,
			status: sandbox.data.status,
		};
		logFieldEffect("tags", before, after);

		expect(sandbox.data.tags).toEqual(
			expect.arrayContaining(["probed", "updated"]),
		);
	});

	it("updates name in place", async () => {
		const newName = `renamed-${Date.now()}`;
		const before = {
			setup: sandbox.data.setup_status,
			status: sandbox.data.status,
		};
		await sandbox.update({ name: newName });
		const after = {
			setup: sandbox.data.setup_status,
			status: sandbox.data.status,
		};
		logFieldEffect("name", before, after);

		expect(sandbox.data.name).toBe(newName);
	});

	it("updates variables in place", async () => {
		const before = {
			setup: sandbox.data.setup_status,
			status: sandbox.data.status,
		};
		await sandbox.update({
			variables: [{ key: "PROBE_VAR", value: "hello", type: "VAR" }],
		});
		const after = {
			setup: sandbox.data.setup_status,
			status: sandbox.data.status,
		};
		logFieldEffect("variables", before, after);

		expect(
			sandbox.data.variables?.some(
				(v) => v.key === "PROBE_VAR" && v.value === "hello",
			),
		).toBe(true);
	});

	it("updates apps in place", async () => {
		const before = {
			setup: sandbox.data.setup_status,
			status: sandbox.data.status,
		};
		await sandbox.update({ apps: [{ command: "echo updated-app" }] });
		const after = {
			setup: sandbox.data.setup_status,
			status: sandbox.data.status,
		};
		logFieldEffect("apps", before, after);

		expect(
			sandbox.data.apps?.some((a) => a.command === "echo updated-app"),
		).toBe(true);
	});

	it("updates app_dir in place", async () => {
		const before = {
			setup: sandbox.data.setup_status,
			status: sandbox.data.status,
		};
		await sandbox.update({ app_dir: "/workspace/probed" });
		const after = {
			setup: sandbox.data.setup_status,
			status: sandbox.data.status,
		};
		logFieldEffect("app_dir", before, after);

		expect(sandbox.data.app_dir).toBe("/workspace/probed");
	});

	it("updates endpoints in place", async () => {
		const before = {
			setup: sandbox.data.setup_status,
			status: sandbox.data.status,
		};
		await sandbox.update({
			endpoints: [
				{
					name: "probed-endpoint",
					endpoint: "127.0.0.1:3000",
					type: "HTTP",
					region: "US",
				},
			],
		});
		const after = {
			setup: sandbox.data.setup_status,
			status: sandbox.data.status,
		};
		logFieldEffect("endpoints", before, after);

		expect(
			sandbox.data.endpoints?.some((e) => e.name === "probed-endpoint"),
		).toBe(true);
	});
});

describe("Sandbox.update — first_boot_commands (isolated sandbox)", () => {
	let sandbox: Sandbox;

	beforeAll(async () => {
		sandbox = await Sandbox.create({
			name: `fbc-probe-${Date.now()}`,
			identifier: `fbc_probe_${Date.now()}`,
			first_boot_commands: "echo initial-first-boot",
		});
	}, 120_000);

	afterAll(async () => {
		await sandbox?.destroy().catch(() => undefined);
	}, 60_000);

	it("changing first_boot_commands after creation: observe setup_status", async () => {
		const before = {
			setup: sandbox.data.setup_status,
			status: sandbox.data.status,
		};
		await sandbox.update({
			first_boot_commands: "echo CHANGED-first-boot",
		});
		await sandbox.refresh();
		const after = {
			setup: sandbox.data.setup_status,
			status: sandbox.data.status,
		};
		logFieldEffect("first_boot_commands", before, after);

		expect(sandbox.data.first_boot_commands).toBe("echo CHANGED-first-boot");
		// Hypothesis: setup_status becomes "STALE". If it stays SUCCESS, our
		// speculation about STALE was wrong and the SDK error message is misleading.
		console.log(
			`[update:first_boot_commands] FINAL setup_status: ${sandbox.data.setup_status}`,
		);
	});
});

describe("Sandbox.update — resources (isolated sandbox)", () => {
	let sandbox: Sandbox;

	beforeAll(async () => {
		sandbox = await Sandbox.create({
			name: `resources-probe-${Date.now()}`,
			identifier: `resources_probe_${Date.now()}`,
			resources: "1x2",
		});
	}, 120_000);

	afterAll(async () => {
		await sandbox?.destroy().catch(() => undefined);
	}, 60_000);

	it("changing resources: observe setup_status / status", async () => {
		const before = {
			setup: sandbox.data.setup_status,
			status: sandbox.data.status,
		};
		await sandbox.update({ resources: "2x4" });
		await sandbox.refresh();
		const after = {
			setup: sandbox.data.setup_status,
			status: sandbox.data.status,
		};
		logFieldEffect("resources", before, after);

		expect(sandbox.data.resources).toBe("2x4");
		console.log(
			`[update:resources] FINAL setup_status: ${sandbox.data.setup_status}, status: ${sandbox.data.status}`,
		);
	});
});
