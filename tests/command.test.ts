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
				output: null,
			});

			expect(command.data).toBeDefined();
			expect(command.data.execution_id).toBeDefined();
			expect(command.data.status).toBeDefined();
		});

		it("should include exit_code after completion", async () => {
			const command = await sandbox.runCommand({
				command: "exit 0",
				output: null,
			});

			expect(command.data.exit_code).toBe(0);
		});
	});

	describe("output()", () => {
		it("should return stdout and stderr interleaved", async () => {
			const command = await sandbox.runCommand({
				command: "echo 'out' && echo 'err' >&2",
				output: null,
				detached: true,
			});

			const output = await command.output();
			expect(output).toContain("out");
			expect(output).toContain("err");
		});
	});

	describe("wait()", () => {
		it("should wait for command completion", async () => {
			const command = await sandbox.runCommand({
				command: "sleep 1 && echo 'done'",
				output: null,
				detached: true,
			});

			expect(command.data.status).toBe("INPROGRESS");

			const finished = await command.wait();
			expect(finished.data.status).toBe("SUCCESSFUL");
		});

		it("should return new Command instance with updated data", async () => {
			const command = await sandbox.runCommand({
				command: "echo 'test'",
				output: null,
				detached: true,
			});

			const finished = await command.wait();

			// Should be different instances
			expect(finished).not.toBe(command);
			expect(finished.data.status).toBe("SUCCESSFUL");
		});
	});

	describe("logs()", () => {
		it("should follow logs until the command finishes", async () => {
			const command = await sandbox.runCommand({
				command: "echo 'log1' && sleep 2 && echo 'log2'",
				output: null,
				detached: true,
			});

			const logs: string[] = [];
			for await (const line of command.logs({ follow: true })) {
				logs.push(line);
			}

			expect(logs).toContain("log1");
			expect(logs).toContain("log2");
		});

		it("should read the log written so far without follow", async () => {
			const command = await sandbox.runCommand({
				command: "echo 'first'",
				output: null,
			});

			const logs: string[] = [];
			for await (const line of command.logs()) {
				logs.push(line);
			}

			expect(logs).toContain("first");
		});
	});

	describe("kill()", () => {
		it("should cancel a running command", async () => {
			const command = await sandbox.runCommand({
				command: "sleep 60",
				output: null,
				detached: true,
			});

			expect(command.data.status).toBe("INPROGRESS");

			await command.kill();

			const finished = await command.wait();
			expect(finished.data.status).toBe("CANCELLED");
		});
	});
});
