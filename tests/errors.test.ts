import { beforeAll, describe, expect, it } from "vitest";
import { FileSystem } from "@/entity/filesystem";
import { Sandbox } from "@/entity/sandbox";
import { BuddySDKError } from "@/errors";
import { testIdentifier, testName } from "~/tests/shared/naming";

/**
 * Error handling tests for Sandbox SDK
 *
 * Tests error cases and edge cases without creating real sandboxes.
 */

describe("Error handling", () => {
	describe("Sandbox.getById", () => {
		it("should throw error for non-existent sandbox ID", async () => {
			await expect(Sandbox.getById("non-existent-id-12345")).rejects.toThrow();
		});

		it("should throw BuddySDKError for invalid sandbox ID", async () => {
			try {
				await Sandbox.getById("invalid-id");
				expect.fail("Should have thrown");
			} catch (error) {
				expect(error).toBeInstanceOf(BuddySDKError);
			}
		});
	});

	describe("Sandbox.list", () => {
		it("should return empty array or sandboxes without error", async () => {
			const sandboxes = await Sandbox.list();
			expect(Array.isArray(sandboxes)).toBe(true);
		});
	});

	describe("FileSystem.forSandbox", () => {
		it("should create FileSystem instance for any sandbox ID", () => {
			const fs = FileSystem.forSandbox("test-sandbox-id");
			expect(fs).toBeDefined();
		});

		it("should fail when listing files for non-existent sandbox", async () => {
			const fs = FileSystem.forSandbox("non-existent-sandbox-id");
			await expect(fs.listFiles("/")).rejects.toThrow();
		});
	});

	describe("Direct constructor protection", () => {
		it("should not allow direct Sandbox construction", () => {
			// @ts-expect-error - Testing that direct construction throws
			expect(() => new Sandbox({}, {}, Symbol())).toThrow();
		});
	});

	describe("Sandbox.createFromSnapshot", () => {
		it("should throw when snapshot ID does not exist", async () => {
			await expect(
				Sandbox.createFromSnapshot("non-existent-snapshot-id-12345", {
					name: testName("restore-fail"),
					identifier: testIdentifier("restore_fail"),
				}),
			).rejects.toThrow();
		});
	});

	describe("sandbox.update and sandbox.getSnapshot on a destroyed sandbox", () => {
		let sandbox: Sandbox;

		beforeAll(async () => {
			sandbox = await Sandbox.create({
				name: testName("error"),
				identifier: testIdentifier("error"),
			});
			await sandbox.destroy();
		}, 120_000);

		it("update() should throw on a deleted sandbox", async () => {
			await expect(sandbox.update({ timeout: 600 })).rejects.toThrow();
		});

		it("getSnapshot() with non-existent snapshot ID should throw", async () => {
			// Re-create a sandbox for this case; destroyed one would fail at path
			// resolution before reaching the snapshot lookup.
			const s = await Sandbox.create({
				name: testName("snapshot-404"),
				identifier: testIdentifier("snapshot_404"),
			});
			try {
				await expect(
					s.getSnapshot("non-existent-snapshot-id-12345"),
				).rejects.toThrow();
			} finally {
				await s.destroy().catch(() => undefined);
			}
		}, 120_000);
	});
});
