import { describe, expect, it } from "vitest";
import { FileSystem } from "@/entity/filesystem";
import { Sandbox } from "@/entity/sandbox";
import { BuddySDKError } from "@/errors";

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
});
