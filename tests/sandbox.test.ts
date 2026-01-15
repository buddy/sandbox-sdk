import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Sandbox } from "@/entity/sandbox";

/**
 * Integration tests for Sandbox SDK
 *
 * These tests run against the real Buddy API.
 * Required environment variables:
 * - BUDDY_WORKSPACE
 * - BUDDY_PROJECT
 * - BUDDY_TOKEN
 */

describe("Sandbox", () => {
	let sandbox: Sandbox;

	beforeAll(async () => {
		sandbox = await Sandbox.create({
			name: `test-sandbox-${Date.now()}`,
			identifier: `test_sandbox_${Date.now()}`,
		});
		await sandbox.waitUntilRunning();
	}, 60_000);

	afterAll(async () => {
		await sandbox?.destroy();
	}, 30_000);

	describe("data properties", () => {
		it("should have id", () => {
			expect(sandbox.data.id).toBeDefined();
			expect(typeof sandbox.data.id).toBe("string");
		});

		it("should have identifier", () => {
			expect(sandbox.data.identifier).toBeDefined();
			expect(typeof sandbox.data.identifier).toBe("string");
		});

		it("should have name", () => {
			expect(sandbox.data.name).toBeDefined();
			expect(sandbox.data.name).toContain("test-sandbox-");
		});

		it("should have status", () => {
			expect(sandbox.data.status).toBeDefined();
			expect([
				"STARTING",
				"RUNNING",
				"STOPPING",
				"STOPPED",
				"FAILED",
				"RESTORING",
			]).toContain(sandbox.data.status);
		});

		it("should have os", () => {
			expect(sandbox.data.os).toBeDefined();
			expect(sandbox.data.os).toContain("ubuntu");
		});

		it("should have setup_status", () => {
			expect(sandbox.data.setup_status).toBeDefined();
			expect(["INPROGRESS", "SUCCESS", "FAILED"]).toContain(
				sandbox.data.setup_status,
			);
		});

		it("should have url and html_url", () => {
			expect(sandbox.data.url).toBeDefined();
			expect(sandbox.data.html_url).toBeDefined();
		});
	});

	describe("lifecycle", () => {
		it("should create a sandbox", () => {
			expect(sandbox.data.id).toBeDefined();
			expect(sandbox.data.name).toContain("test-sandbox-");
		});

		it("should get sandbox by ID", async () => {
			const sandboxId = sandbox.data.id;
			expect(sandboxId).toBeDefined();

			const fetched = await Sandbox.getById(sandboxId as string);
			expect(fetched.data.id).toBe(sandboxId);
		});

		it("should list sandboxes", async () => {
			const sandboxes = await Sandbox.list();
			expect(sandboxes.length).toBeGreaterThan(0);

			const found = sandboxes.find((s) => s.data.id === sandbox.data.id);
			expect(found).toBeDefined();
		});

		it("should list sandboxes in simple mode", async () => {
			const sandboxes = await Sandbox.list({ simple: true });
			expect(sandboxes.length).toBeGreaterThan(0);
		});

		it("should refresh sandbox data", async () => {
			const oldData = { ...sandbox.data };
			await sandbox.refresh();
			expect(sandbox.data.id).toBe(oldData.id);
		});
	});

	describe("commands", () => {
		it("should run a command and get output", async () => {
			const command = await sandbox.runCommand({
				command: "echo 'hello world'",
				stdout: null,
				stderr: null,
			});

			expect(command.data.id).toBeDefined();

			const finished = await command.wait();
			expect(finished.data.status).toBe("SUCCESSFUL");
			expect(finished.data.exit_code).toBe(0);
		});

		it("should run a detached command", async () => {
			const command = await sandbox.runCommand({
				command: "sleep 1 && echo 'done'",
				stdout: null,
				stderr: null,
				detached: true,
			});

			// Detached should return immediately with INPROGRESS status
			expect(command.data.id).toBeDefined();
			expect(command.data.status).toBe("INPROGRESS");

			// Wait for completion
			const finished = await command.wait();
			expect(finished.data.status).toBe("SUCCESSFUL");
		});

		it("should capture stdout", async () => {
			const command = await sandbox.runCommand({
				command: "echo 'test output'",
				stdout: null,
				stderr: null,
			});

			const output = await command.stdout();
			expect(output).toContain("test output");
		});

		it("should capture stderr", async () => {
			const command = await sandbox.runCommand({
				command: "echo 'error message' >&2",
				stdout: null,
				stderr: null,
			});

			const output = await command.stderr();
			expect(output).toContain("error message");
		});

		it("should capture both stdout and stderr with output()", async () => {
			const command = await sandbox.runCommand({
				command: "echo 'stdout' && echo 'stderr' >&2",
				stdout: null,
				stderr: null,
			});

			const bothOutput = await command.output("BOTH");
			expect(bothOutput).toContain("stdout");
			expect(bothOutput).toContain("stderr");

			// Create new command for stdout-only test
			const cmd2 = await sandbox.runCommand({
				command: "echo 'out' && echo 'err' >&2",
				stdout: null,
				stderr: null,
			});
			const stdoutOnly = await cmd2.output("STDOUT");
			expect(stdoutOnly).toContain("out");
			expect(stdoutOnly).not.toContain("err");
		});

		it("should handle failed commands", async () => {
			const command = await sandbox.runCommand({
				command: "exit 1",
				stdout: null,
				stderr: null,
			});

			const finished = await command.wait();
			expect(finished.data.status).toBe("FAILED");
			expect(finished.data.exit_code).toBe(1);
		});

		it("should handle different exit codes", async () => {
			const command = await sandbox.runCommand({
				command: "exit 42",
				stdout: null,
				stderr: null,
			});

			const finished = await command.wait();
			expect(finished.data.exit_code).toBe(42);
		});

		it("should stream logs", async () => {
			const command = await sandbox.runCommand({
				command: "echo 'line1' && echo 'line2'",
				stdout: null,
				stderr: null,
			});

			const logs: string[] = [];
			for await (const log of command.logs({ follow: true })) {
				if (log.data) logs.push(log.data);
			}

			expect(logs.some((l) => l.includes("line1"))).toBe(true);
			expect(logs.some((l) => l.includes("line2"))).toBe(true);
		});

		it("should kill a running command", async () => {
			const command = await sandbox.runCommand({
				command: "sleep 60",
				stdout: null,
				stderr: null,
				detached: true,
			});

			expect(command.data.status).toBe("INPROGRESS");

			await command.kill();

			// Wait a bit for the kill to take effect
			await new Promise((resolve) => setTimeout(resolve, 1000));

			const finished = await command.wait();
			expect(finished.data.status).toBe("FAILED");
		});

		it("should access command data properties", async () => {
			const command = await sandbox.runCommand({
				command: "echo 'test'",
				stdout: null,
				stderr: null,
			});

			expect(command.data.id).toBeDefined();
			expect(command.data.status).toBeDefined();
		});
	});

	describe("filesystem", () => {
		const testDir = "test-dir";
		const testFile = "test-file.txt";
		const testContent = "Hello from integration test!";

		it("should list files in root directory", async () => {
			const files = await sandbox.fs.listFiles("/");
			expect(Array.isArray(files)).toBe(true);
		});

		it("should create a folder", async () => {
			await sandbox.fs.createFolder(testDir);

			const files = await sandbox.fs.listFiles("/");
			const found = files.find((f) => f.name === testDir);
			expect(found).toBeDefined();
			expect(found?.type).toBe("DIR");
		});

		it("should upload a file", async () => {
			const buffer = Buffer.from(testContent);
			await sandbox.fs.uploadFile(buffer, `${testDir}/${testFile}`);

			const files = await sandbox.fs.listFiles(testDir);
			const found = files.find((f) => f.name === testFile);
			expect(found).toBeDefined();
			expect(found?.type).toBe("FILE");
		});

		it("should download a file", async () => {
			const content = await sandbox.fs.downloadFile(`${testDir}/${testFile}`);
			expect(content.toString()).toBe(testContent);
		});

		it("should delete a file", async () => {
			await sandbox.fs.deleteFile(`${testDir}/${testFile}`);

			const files = await sandbox.fs.listFiles(testDir);
			const found = files.find((f) => f.name === testFile);
			expect(found).toBeUndefined();
		});

		it("should delete a folder", async () => {
			await sandbox.fs.deleteFile(testDir);

			const files = await sandbox.fs.listFiles("/");
			const found = files.find((f) => f.name === testDir);
			expect(found).toBeUndefined();
		});
	});

	describe("state management", () => {
		it("should stop the sandbox", async () => {
			await sandbox.stop();
			await sandbox.waitUntilStopped();

			await sandbox.refresh();
			expect(sandbox.data.status).toBe("STOPPED");
		});

		it("should start the sandbox", async () => {
			await sandbox.start();
			await sandbox.waitUntilRunning();

			await sandbox.refresh();
			expect(sandbox.data.status).toBe("RUNNING");
		});

		it("should restart the sandbox", async () => {
			await sandbox.restart();
			await sandbox.waitUntilRunning();

			await sandbox.refresh();
			expect(sandbox.data.status).toBe("RUNNING");
		});
	});
});
