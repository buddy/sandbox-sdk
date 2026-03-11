import { afterAll, describe, expect, it } from "vitest";
import { Sandbox } from "@/entity/sandbox";

/**
 * Tests for Sandbox.create with different configuration options
 */

describe("Sandbox.create options", () => {
	const sandboxes: Sandbox[] = [];

	afterAll(async () => {
		// Clean up all created sandboxes
		await Promise.all(sandboxes.map((s) => s.destroy()));
	});

	it("should create sandbox with default options", async () => {
		const sandbox = await Sandbox.create({
			identifier: `default_opts_${Date.now()}`,
		});
		sandboxes.push(sandbox);

		expect(sandbox.data.id).toBeDefined();
		expect(sandbox.data.os).toBe("ubuntu:24.04");
	});

	it("should create sandbox with custom name", async () => {
		const customName = `custom-name-${Date.now()}`;
		const sandbox = await Sandbox.create({ name: customName });
		sandboxes.push(sandbox);

		expect(sandbox.data.name).toBe(customName);
	});

	it("should create sandbox with custom identifier", async () => {
		const customIdentifier = `custom_id_${Date.now()}`;
		const sandbox = await Sandbox.create({ identifier: customIdentifier });
		sandboxes.push(sandbox);

		expect(sandbox.data.identifier).toBe(customIdentifier);
	});

	it("should create sandbox with ubuntu 22.04", async () => {
		const sandbox = await Sandbox.create({ os: "ubuntu:22.04" });
		sandboxes.push(sandbox);

		expect(sandbox.data.os).toBe("ubuntu:22.04");
	});

	it("should reject duplicate identifier", async () => {
		const identifier = `duplicate_test_${Date.now()}`;

		// Create first sandbox
		const sandbox1 = await Sandbox.create({ identifier });
		sandboxes.push(sandbox1);

		// Create second with same identifier - should fail
		await expect(Sandbox.create({ identifier })).rejects.toThrow(
			"'identifier' must be unique",
		);
	});
});
