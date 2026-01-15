import * as fs from "node:fs";
import type { SandboxContentItem } from "@/api/openapi";
import type { BuddyApiClient } from "@/core/buddy-api-client";
import { createClient, type ConnectionConfig } from "@/utils/client";
import { withErrorHandler } from "@/errors";

/**
 * File information returned by file system operations
 */
export interface FileInfo {
	/** File or directory name */
	name: string;
	/** Full path to the file or directory */
	path: string;
	/** Type: "FILE" or "DIR" */
	type: "FILE" | "DIR";
	/** Size in bytes (for files) */
	size?: bigint;
	/** API URL for this item */
	url?: string;
	/** Web URL for viewing in Buddy.works */
	htmlUrl?: string;
}

/**
 * Configuration for getting a FileSystem instance
 */
export interface GetFileSystemConfig {
	/** Optional connection configuration to override defaults */
	connection?: ConnectionConfig;
}

/**
 * Provides file system operations within a Sandbox.
 *
 * FileSystem instances can be created either direct via `FileSystem.forSandbox()`
 * or accessed via the `Sandbox.fs` property.
 */
export class FileSystem {
	readonly #client: BuddyApiClient;
	readonly #sandboxId: string;

	/**
	 * Create a FileSystem instance for a specific sandbox.
	 *
	 * @param sandboxId - The ID of the sandbox
	 * @param config - Optional configuration including connection settings
	 * @returns A FileSystem instance for the specified sandbox
	 */
	static forSandbox(
		sandboxId: string,
		config?: GetFileSystemConfig,
	): FileSystem {
		const client = createClient(config?.connection);
		return new FileSystem(client, sandboxId);
	}

	constructor(client: BuddyApiClient, sandboxId: string) {
		this.#client = client;
		this.#sandboxId = sandboxId;
	}

	/**
	 * Lists contents of a directory in the Sandbox.
	 *
	 * @param dirPath - Directory path to list. Relative paths are resolved based on the sandbox working directory.
	 * @returns Array of file and directory information
	 */
	async listFiles(dirPath: string): Promise<FileInfo[]> {
		return withErrorHandler("Failed to list files", async () => {
			const response = await this.#client.getSandboxContent({
				path: {
					sandbox_id: this.#sandboxId,
					path: this.#normalizePath(dirPath),
				},
			});

			return (response.contents ?? []).map((item) =>
				this.#mapContentItemToFileInfo(item),
			);
		});
	}

	/**
	 * Create a new directory in the Sandbox.
	 *
	 * @param dirPath - Path where the directory should be created
	 */
	async createFolder(dirPath: string): Promise<void> {
		return withErrorHandler("Failed to create folder", async () => {
			await this.#client.createSandboxDirectory({
				path: {
					sandbox_id: this.#sandboxId,
					path: this.#normalizePath(dirPath),
				},
			});
		});
	}

	/**
	 * Deletes a file or directory from the Sandbox.
	 *
	 * @param filePath - Path to the file or directory to delete
	 */
	async deleteFile(filePath: string): Promise<void> {
		return withErrorHandler("Failed to delete file", async () => {
			await this.#client.deleteSandboxFile({
				path: {
					sandbox_id: this.#sandboxId,
					path: this.#normalizePath(filePath),
				},
			});
		});
	}

	/**
	 * Downloads a file from the Sandbox.
	 *
	 * @param remotePath - Path to the file in the Sandbox
	 * @param localPath - Optional local path to save the file
	 * @returns File contents as a Buffer
	 */
	async downloadFile(remotePath: string, localPath?: string): Promise<Buffer> {
		return withErrorHandler("Failed to download file", async () => {
			const { data } = await this.#client.downloadSandboxContent({
				path: {
					sandbox_id: this.#sandboxId,
					path: this.#normalizePath(remotePath),
				},
			});

			const buffer = Buffer.from(data);

			if (localPath) {
				await fs.promises.writeFile(localPath, buffer);
			}

			return buffer;
		});
	}

	/**
	 * Uploads a file to the Sandbox.
	 *
	 * @param source - Buffer with content or path to local file
	 * @param remotePath - Destination path in the Sandbox
	 */
	async uploadFile(source: Buffer | string, remotePath: string): Promise<void> {
		return withErrorHandler("Failed to upload file", async () => {
			let blob: Blob;

			if (Buffer.isBuffer(source)) {
				blob = new Blob([source]);
			} else {
				// Read local file
				const fileContent = await fs.promises.readFile(source);
				blob = new Blob([fileContent]);
			}

			await this.#client.uploadSandboxFile({
				body: blob,
				path: {
					sandbox_id: this.#sandboxId,
					path: this.#normalizePath(remotePath),
				},
			});
		});
	}

	#mapContentItemToFileInfo(item: SandboxContentItem): FileInfo {
		return {
			name: item.name ?? "",
			path: item.path ?? "",
			type: item.type ?? "FILE",
			size: item.size,
			url: item.url,
			htmlUrl: item.html_url,
		};
	}

	/**
	 * Normalize path for API calls - strip leading slash.
	 * API expects: "buddy/src" not "/buddy/src"
	 */
	#normalizePath(filePath: string): string {
		return filePath.startsWith("/") ? filePath.slice(1) : filePath;
	}
}
