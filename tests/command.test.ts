import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Sandbox } from "@/entity/sandbox";

/**
 * Tests for Command class methods
 */

describe("Command", () => {
	let sandbox: Sandbox;

	beforeAll(async () => {
		sandbox = await Sandbox.create({
			name: `command-test-${Date.now()}`,
			identifier: `command_test_${Date.now()}`,
		});
		await sandbox.waitUntilRunning();
	}, 60_000);

	afterAll(async () => {
		await sandbox?.destroy();
	}, 30_000);

	describe("data getter", () => {
		it("should return command response data", async () => {
			const command = await sandbox.runCommand({
				command: "echo 'test'",
				stdout: null,
				stderr: null,
			});

			expect(command.data).toBeDefined();
			expect(command.data.id).toBeDefined();
			expect(command.data.status).toBeDefined();
		});

		it("should include exit_code after completion", async () => {
			const command = await sandbox.runCommand({
				command: "exit 0",
				stdout: null,
				stderr: null,
			});

			expect(command.data.exit_code).toBe(0);
		});
	});

	describe("output()", () => {
		it("should return stdout only with STDOUT option", async () => {
			const command = await sandbox.runCommand({
				command: "echo 'stdout' && echo 'stderr' >&2",
				stdout: null,
				stderr: null,
				detached: true,
			});

			const output = await command.output("STDOUT");
			expect(output).toContain("stdout");
			expect(output).not.toContain("stderr");
		});

		it("should return stderr only with STDERR option", async () => {
			const command = await sandbox.runCommand({
				command: "echo 'stdout' && echo 'stderr' >&2",
				stdout: null,
				stderr: null,
				detached: true,
			});

			const output = await command.output("STDERR");
			expect(output).toContain("stderr");
			expect(output).not.toContain("stdout");
		});

		it("should return both streams with BOTH option", async () => {
			const command = await sandbox.runCommand({
				command: "echo 'stdout' && echo 'stderr' >&2",
				stdout: null,
				stderr: null,
				detached: true,
			});

			const output = await command.output("BOTH");
			expect(output).toContain("stdout");
			expect(output).toContain("stderr");
		});

		it("should default to BOTH when no option provided", async () => {
			const command = await sandbox.runCommand({
				command: "echo 'out' && echo 'err' >&2",
				stdout: null,
				stderr: null,
				detached: true,
			});

			const output = await command.output();
			expect(output).toContain("out");
			expect(output).toContain("err");
		});
	});

	describe("stdout() and stderr()", () => {
		it("should return only stdout", async () => {
			const command = await sandbox.runCommand({
				command: "echo 'hello stdout'",
				stdout: null,
				stderr: null,
				detached: true,
			});

			const output = await command.stdout();
			expect(output).toContain("hello stdout");
		});

		it("should return only stderr", async () => {
			const command = await sandbox.runCommand({
				command: "echo 'hello stderr' >&2",
				stdout: null,
				stderr: null,
				detached: true,
			});

			const output = await command.stderr();
			expect(output).toContain("hello stderr");
		});
	});

	describe("wait()", () => {
		it("should wait for command completion", async () => {
			const command = await sandbox.runCommand({
				command: "sleep 1 && echo 'done'",
				stdout: null,
				stderr: null,
				detached: true,
			});

			expect(command.data.status).toBe("INPROGRESS");

			const finished = await command.wait();
			expect(finished.data.status).toBe("SUCCESSFUL");
		});

		it("should return new Command instance with updated data", async () => {
			const command = await sandbox.runCommand({
				command: "echo 'test'",
				stdout: null,
				stderr: null,
				detached: true,
			});

			const finished = await command.wait();

			// Should be different instances
			expect(finished).not.toBe(command);
			expect(finished.data.status).toBe("SUCCESSFUL");
		});
	});

	describe("logs()", () => {
		it("should stream logs with follow option", async () => {
			const command = await sandbox.runCommand({
				command: "echo 'log1' && echo 'log2'",
				stdout: null,
				stderr: null,
				detached: true,
			});

			const logs: string[] = [];
			for await (const log of command.logs({ follow: true })) {
				if (log.data) logs.push(log.data);
			}

			expect(logs.some((l) => l.includes("log1"))).toBe(true);
			expect(logs.some((l) => l.includes("log2"))).toBe(true);
		});

		it("should include log type (STDOUT/STDERR)", async () => {
			const command = await sandbox.runCommand({
				command: "echo 'out' && echo 'err' >&2",
				stdout: null,
				stderr: null,
				detached: true,
			});

			const logTypes: string[] = [];
			for await (const log of command.logs({ follow: true })) {
				if (log.type) logTypes.push(log.type);
			}

			expect(logTypes).toContain("STDOUT");
			expect(logTypes).toContain("STDERR");
		});
	});

	describe("kill()", () => {
		it("should terminate a running command", async () => {
			const command = await sandbox.runCommand({
				command: "sleep 60",
				stdout: null,
				stderr: null,
				detached: true,
			});

			expect(command.data.status).toBe("INPROGRESS");

			await command.kill();

			const finished = await command.wait();
			expect(finished.data.status).toBe("FAILED");
		});
	});
});
