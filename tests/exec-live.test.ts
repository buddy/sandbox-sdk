import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Sandbox } from "@/entity/sandbox";

/**
 * Tests for sandbox.exec() against the real API
 */

describe("Sandbox.exec", () => {
	let sandbox: Sandbox;

	beforeAll(async () => {
		sandbox = await Sandbox.create({
			name: `exec-test-${Date.now()}`,
			identifier: `exec_test_${Date.now()}`,
		});
		await sandbox.waitUntilRunning();
	}, 120_000);

	afterAll(async () => {
		await sandbox?.destroy();
	}, 30_000);

	it("should return stdout and a zero exit code", async () => {
		const result = await sandbox.exec({ command: "echo hello" });

		expect(result.exit_code).toBe(0);
		expect(result.stdout).toContain("hello");
		expect(result.stderr).toBe("");
	});

	it("should report a non-zero exit code as a result", async () => {
		const result = await sandbox.exec({
			command: "echo boom >&2 && exit 3",
		});

		expect(result.exit_code).toBe(3);
		expect(result.stderr).toContain("boom");
	});

	it("should echo the request back rather than the runtime it used", async () => {
		const result = await sandbox.exec({ command: "true" });

		expect(result.command).toBe("true");
		// BASH is applied when building the command, not when answering.
		expect(result.runtime).toBeUndefined();
	});

	it("should run in a non-default runtime and echo it", async () => {
		const result = await sandbox.exec({
			command: "print(6 * 7)",
			runtime: "PYTHON",
		});

		expect(result.exit_code).toBe(0);
		expect(result.stdout).toContain("42");
		expect(result.runtime).toBe("PYTHON");
	});

	it("should leave no trace in the command history", async () => {
		const before = await sandbox.listCommands();
		await sandbox.exec({ command: "echo untracked" });
		const after = await sandbox.listCommands();

		expect(after.length).toBe(before.length);
	});
});
