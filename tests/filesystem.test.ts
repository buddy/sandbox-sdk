import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FileSystem } from "@/entity/filesystem";
import { Sandbox } from "@/entity/sandbox";

/**
 * Tests for FileSystem class methods
 */

describe("FileSystem", () => {
	let sandbox: Sandbox;

	beforeAll(async () => {
		sandbox = await Sandbox.create({
			name: `filesystem-test-${Date.now()}`,
			identifier: `filesystem_test_${Date.now()}`,
		});
		await sandbox.waitUntilRunning();
	}, 60_000);

	afterAll(async () => {
		await sandbox?.destroy();
	}, 30_000);

	describe("FileSystem.forSandbox()", () => {
		it("should create FileSystem instance for sandbox ID", () => {
			const fileSystem = FileSystem.forSandbox(sandbox.initializedId);
			expect(fileSystem).toBeInstanceOf(FileSystem);
		});

		it("should work with the created instance", async () => {
			const fileSystem = FileSystem.forSandbox(sandbox.initializedId);
			const files = await fileSystem.listFiles("/");
			expect(Array.isArray(files)).toBe(true);
		});
	});

	describe("sandbox.fs getter", () => {
		it("should return FileSystem instance", () => {
			expect(sandbox.fs).toBeInstanceOf(FileSystem);
		});

		it("should return same instance on multiple accesses", () => {
			const fs1 = sandbox.fs;
			const fs2 = sandbox.fs;
			expect(fs1).toBe(fs2);
		});
	});

	describe("listFiles()", () => {
		it("should list root directory", async () => {
			const files = await sandbox.fs.listFiles("/");
			expect(Array.isArray(files)).toBe(true);
		});

		it("should return FileInfo objects with required properties", async () => {
			const files = await sandbox.fs.listFiles("/");

			if (files.length > 0) {
				const file = files[0];
				if (!file) throw new Error("No files found in root directory");

				expect(file).toHaveProperty("name");
				expect(file).toHaveProperty("path");
				expect(file).toHaveProperty("type");
				expect(["FILE", "DIR"]).toContain(file.type);
			}
		});

		it("should handle paths without leading slash", async () => {
			// Create a test directory first
			await sandbox.fs.createFolder("/listtest");
			const files = await sandbox.fs.listFiles("listtest");
			expect(Array.isArray(files)).toBe(true);
			await sandbox.fs.deleteFile("/listtest");
		});
	});

	describe("createFolder()", () => {
		it("should create a new directory", async () => {
			const dirName = `testdir_${Date.now()}`;
			await sandbox.fs.createFolder(dirName);

			const files = await sandbox.fs.listFiles("/");
			const found = files.find((f) => f.name === dirName);
			expect(found).toBeDefined();
			expect(found?.type).toBe("DIR");

			// Cleanup
			await sandbox.fs.deleteFile(dirName);
		});

		it("should create nested directories", async () => {
			const parentDir = `parent_${Date.now()}`;
			const childDir = `${parentDir}/child`;

			await sandbox.fs.createFolder(parentDir);
			await sandbox.fs.createFolder(childDir);

			const files = await sandbox.fs.listFiles(parentDir);
			const found = files.find((f) => f.name === "child");
			expect(found).toBeDefined();
			expect(found?.type).toBe("DIR");

			// Cleanup
			await sandbox.fs.deleteFile(childDir);
			await sandbox.fs.deleteFile(parentDir);
		});
	});

	describe("uploadFile()", () => {
		it("should upload from Buffer", async () => {
			const fileName = `buffer_upload_${Date.now()}.txt`;
			const content = "Hello from buffer!";
			const buffer = Buffer.from(content);

			await sandbox.fs.uploadFile(buffer, fileName);

			const files = await sandbox.fs.listFiles("/");
			const found = files.find((f) => f.name === fileName);
			expect(found).toBeDefined();
			expect(found?.type).toBe("FILE");

			// Verify content
			const downloaded = await sandbox.fs.downloadFile(fileName);
			expect(downloaded.toString()).toBe(content);

			// Cleanup
			await sandbox.fs.deleteFile(fileName);
		});

		it("should upload from local file path", async () => {
			const localFile = path.join(
				os.tmpdir(),
				`local_upload_${Date.now()}.txt`,
			);
			const remoteFile = `remote_upload_${Date.now()}.txt`;
			const content = "Hello from local file!";

			// Create local file
			await fs.promises.writeFile(localFile, content);

			try {
				await sandbox.fs.uploadFile(localFile, remoteFile);

				const downloaded = await sandbox.fs.downloadFile(remoteFile);
				expect(downloaded.toString()).toBe(content);

				// Cleanup remote
				await sandbox.fs.deleteFile(remoteFile);
			} finally {
				// Cleanup local
				await fs.promises.unlink(localFile);
			}
		});

		it("should upload binary content", async () => {
			const fileName = `binary_${Date.now()}.bin`;
			const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);

			await sandbox.fs.uploadFile(binaryData, fileName);

			const downloaded = await sandbox.fs.downloadFile(fileName);
			expect(Buffer.compare(downloaded, binaryData)).toBe(0);

			// Cleanup
			await sandbox.fs.deleteFile(fileName);
		});
	});

	describe("downloadFile()", () => {
		const testFileName = `download_test_${Date.now()}.txt`;
		const testContent = "Download test content";

		beforeAll(async () => {
			await sandbox.fs.uploadFile(Buffer.from(testContent), testFileName);
		});

		afterAll(async () => {
			await sandbox.fs.deleteFile(testFileName);
		});

		it("should download file as Buffer", async () => {
			const content = await sandbox.fs.downloadFile(testFileName);
			expect(Buffer.isBuffer(content)).toBe(true);
			expect(content.toString()).toBe(testContent);
		});

		it("should save to local path when provided", async () => {
			const localPath = path.join(os.tmpdir(), `downloaded_${Date.now()}.txt`);

			try {
				const content = await sandbox.fs.downloadFile(testFileName, localPath);

				// Should still return buffer
				expect(content.toString()).toBe(testContent);

				// Should also save to file
				const fileContent = await fs.promises.readFile(localPath, "utf-8");
				expect(fileContent).toBe(testContent);
			} finally {
				await fs.promises.unlink(localPath);
			}
		});
	});

	describe("deleteFile()", () => {
		it("should delete a file", async () => {
			const fileName = `to_delete_${Date.now()}.txt`;
			await sandbox.fs.uploadFile(Buffer.from("delete me"), fileName);

			// Verify exists
			let files = await sandbox.fs.listFiles("/");
			expect(files.find((f) => f.name === fileName)).toBeDefined();

			// Delete
			await sandbox.fs.deleteFile(fileName);

			// Verify deleted
			files = await sandbox.fs.listFiles("/");
			expect(files.find((f) => f.name === fileName)).toBeUndefined();
		});

		it("should delete a directory", async () => {
			const dirName = `dir_to_delete_${Date.now()}`;
			await sandbox.fs.createFolder(dirName);

			// Verify exists
			let files = await sandbox.fs.listFiles("/");
			expect(files.find((f) => f.name === dirName)).toBeDefined();

			// Delete
			await sandbox.fs.deleteFile(dirName);

			// Verify deleted
			files = await sandbox.fs.listFiles("/");
			expect(files.find((f) => f.name === dirName)).toBeUndefined();
		});
	});

	describe("path normalization", () => {
		it("should handle paths with leading slash", async () => {
			const dirName = `slash_test_${Date.now()}`;
			await sandbox.fs.createFolder(`/${dirName}`);

			const files = await sandbox.fs.listFiles("/");
			expect(files.find((f) => f.name === dirName)).toBeDefined();

			await sandbox.fs.deleteFile(`/${dirName}`);
		});

		it("should handle paths without leading slash", async () => {
			const dirName = `noslash_test_${Date.now()}`;
			await sandbox.fs.createFolder(dirName);

			const files = await sandbox.fs.listFiles("/");
			expect(files.find((f) => f.name === dirName)).toBeDefined();

			await sandbox.fs.deleteFile(dirName);
		});
	});
});
