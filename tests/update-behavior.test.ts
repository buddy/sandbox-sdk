import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Sandbox } from "@/entity/sandbox";

/**
 * Contract tests for `sandbox.update()` — assert how the backend reacts to
 * PATCH on each field of UpdateSandboxRequestWritable. Documents and pins:
 *   - "soft" fields apply in place: sandbox stays RUNNING + setup SUCCESS
 *   - `first_boot_commands` transitions setup to STALE (recreate required)
 *   - `resources` change applies in place (no restart/recreate)
 *
 * If a backend change breaks these contracts, these tests fail loudly.
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

	const assertSoftUpdate = (label: string) => {
		const before = {
			setup: sandbox.data.setup_status,
			status: sandbox.data.status,
		};
		return {
			before,
			finish: () => {
				const after = {
					setup: sandbox.data.setup_status,
					status: sandbox.data.status,
				};
				logFieldEffect(label, before, after);
				expect(after.setup).toBe("SUCCESS");
				expect(after.status).toBe("RUNNING");
			},
		};
	};

	it("updates timeout in place without leaving setup STALE", async () => {
		const probe = assertSoftUpdate("timeout");
		await sandbox.update({ timeout: 1800 });
		expect(sandbox.data.timeout).toBe(1800);
		probe.finish();
	});

	it("updates tags in place without leaving setup STALE", async () => {
		const probe = assertSoftUpdate("tags");
		await sandbox.update({ tags: ["probed", "updated"] });
		expect(sandbox.data.tags).toEqual(
			expect.arrayContaining(["probed", "updated"]),
		);
		probe.finish();
	});

	it("updates name in place without leaving setup STALE", async () => {
		const newName = `renamed-${Date.now()}`;
		const probe = assertSoftUpdate("name");
		await sandbox.update({ name: newName });
		expect(sandbox.data.name).toBe(newName);
		probe.finish();
	});

	it("updates variables in place without leaving setup STALE", async () => {
		const probe = assertSoftUpdate("variables");
		await sandbox.update({
			variables: [{ key: "PROBE_VAR", value: "hello", type: "VAR" }],
		});
		expect(
			sandbox.data.variables?.some(
				(v) => v.key === "PROBE_VAR" && v.value === "hello",
			),
		).toBe(true);
		probe.finish();
	});

	it("updates apps in place without leaving setup STALE", async () => {
		const probe = assertSoftUpdate("apps");
		await sandbox.update({ apps: [{ command: "echo updated-app" }] });
		expect(
			sandbox.data.apps?.some((a) => a.command === "echo updated-app"),
		).toBe(true);
		probe.finish();
	});

	it("updates app_dir in place without leaving setup STALE", async () => {
		const probe = assertSoftUpdate("app_dir");
		await sandbox.update({ app_dir: "/workspace/probed" });
		expect(sandbox.data.app_dir).toBe("/workspace/probed");
		probe.finish();
	});

	it("updates endpoints in place without leaving setup STALE", async () => {
		const probe = assertSoftUpdate("endpoints");
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
		expect(
			sandbox.data.endpoints?.some((e) => e.name === "probed-endpoint"),
		).toBe(true);
		probe.finish();
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

	it("changing first_boot_commands transitions setup_status to STALE", async () => {
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
		expect(sandbox.data.setup_status).toBe("STALE");
		expect(sandbox.data.status).toBe("RUNNING");
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

	it("changing resources applies in place without leaving setup STALE", async () => {
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
		expect(sandbox.data.setup_status).toBe("SUCCESS");
		expect(sandbox.data.status).toBe("RUNNING");
	});
});
