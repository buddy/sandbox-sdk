import type { Writable } from "node:stream";
import type {
	CreateNewSandboxRequestWritable,
	ExecuteSandboxCommandRequest,
	GetSandboxResponse,
	SandboxIdView,
} from "@/api/openapi";
import type { BuddyApiClient } from "@/core/buddy-api-client";
import { Command } from "@/entity/command";
import { FileSystem } from "@/entity/filesystem";
import { withErrorHandler } from "@/errors";
import { type ConnectionConfig, createClient } from "@/utils/client";
import logger from "@/utils/logger";

export type { ConnectionConfig };

// Symbol for private constructor protection
const PRIVATE_CONSTRUCTOR_KEY = Symbol("SandboxConstructor");
const INITIALIZE_INSTRUCTIONS =
	"Use Sandbox.create(), Sandbox.getById(), or Sandbox.getByIdentifier() to obtain an instance.";

/**
 * Configuration for creating a new sandbox
 */
export interface CreateSandboxConfig
	extends Partial<CreateNewSandboxRequestWritable> {
	/** Optional connection configuration to override defaults */
	connection?: ConnectionConfig;
}

/**
 * Configuration for getting an existing sandbox
 */
export interface GetSandboxConfig {
	/** Optional connection configuration to override defaults */
	connection?: ConnectionConfig;
}

/**
 * Configuration for listing sandboxes
 */
export interface ListSandboxesConfig {
	/** Optional connection configuration to override defaults */
	connection?: ConnectionConfig;
}

/**
 * Options for running a command in the sandbox
 */
interface RunCommandOptions extends ExecuteSandboxCommandRequest {
	/** Stream to write stdout to (default: process.stdout, null to disable) */
	stdout?: Writable | null;
	/** Stream to write stderr to (default: process.stderr, null to disable) */
	stderr?: Writable | null;
	/** Whether to run the command in detached mode (non-blocking) */
	detached?: boolean;
}

export class Sandbox {
	#sandboxData?: GetSandboxResponse;
	readonly #client: BuddyApiClient;
	#fs?: FileSystem;

	/** The raw sandbox response data from the API */
	get data() {
		return this.#sandboxData ?? {};
	}

	/** The sandbox ID, throws if not initialized */
	get initializedId(): NonNullable<GetSandboxResponse["id"]> {
		const id = this.#sandboxData?.id;
		if (!id) {
			throw new Error(
				`Sandbox ID is missing. The sandbox may have been deleted or not properly initialized. ${INITIALIZE_INSTRUCTIONS}`,
			);
		}
		return id;
	}

	/**
	 * File system operations for this sandbox.
	 * Provides methods for listing, uploading, downloading, and managing files.
	 */
	get fs(): FileSystem {
		const sandboxId = this.initializedId;
		if (!this.#fs) {
			this.#fs = new FileSystem(this.#client, sandboxId);
		}
		return this.#fs;
	}

	/**
	 * Create a new sandbox
	 * @param config - Sandbox configuration including identifier, name, os, and optional connection settings
	 * @returns A ready-to-use Sandbox instance
	 */
	static async create(config?: CreateSandboxConfig) {
		return withErrorHandler("Failed to create sandbox", async () => {
			const { connection, ...sandboxConfig } = config ?? {};
			const client = createClient(connection);

			const requestBody: CreateNewSandboxRequestWritable = {
				name: `Sandbox ${new Date().toISOString()}`,
				identifier: config?.identifier || `sandbox_${String(Date.now())}`,
				os: "ubuntu:24.04",
				...sandboxConfig,
			};

			const sandboxResponse = await client.addSandbox({
				body: requestBody,
			});

			const sandbox = new Sandbox(
				sandboxResponse,
				client,
				PRIVATE_CONSTRUCTOR_KEY,
			);

			logger.debug(`Waiting for sandbox ${sandbox.data.id} to be ready...`);

			await sandbox.waitUntilReady();

			logger.debug(
				`Sandbox ${sandbox.data.id} is ready (Setup status: ${sandbox.data.setup_status})`,
			);

			await sandbox.waitUntilRunning();

			logger.debug(
				`Sandbox ${sandbox.data.id} is now running. Status: ${sandbox.data.status}`,
			);

			return sandbox;
		});
	}

	/**
	 * Get an existing sandbox by its identifier
	 * @param identifier - Identifier of the sandbox to retrieve
	 * @param config - Optional configuration including connection settings
	 * @returns The Sandbox instance
	 */
	static async getByIdentifier(
		identifier: NonNullable<GetSandboxResponse["identifier"]>,
		config?: GetSandboxConfig,
	) {
		return withErrorHandler("Failed to get sandbox by identifier", async () => {
			const { connection } = config ?? {};
			const client = createClient(connection);

			let sandboxId: NonNullable<GetSandboxResponse["id"]> | undefined;

			try {
				const identifiers = await client.getIdentifiers({
					query: { project: client.project_name, sandbox: identifier },
				});
				sandboxId = identifiers.sandbox_id;
			} catch {}

			// <TODO>: Remove this fallback when the identifiers endpoint is rolled out to prod
			if (!sandboxId) {
				try {
					const sandboxList = await client.getSandboxes({});
					sandboxId = sandboxList?.sandboxes?.find(
						(s) => s.identifier === identifier,
					)?.id;
				} catch {}
			} // </TODO>

			if (!sandboxId) {
				throw new Error(`Sandbox with identifier '${identifier}' not found`);
			}

			const sandboxResponse = await client.getSandboxById({
				path: { id: sandboxId },
			});

			if (!sandboxResponse) {
				throw new Error(`Sandbox with ID '${sandboxId}' not found`);
			}

			return new Sandbox(sandboxResponse, client, PRIVATE_CONSTRUCTOR_KEY);
		});
	}

	/**
	 * Get an existing sandbox by its ID
	 * @param sandboxId - ID of the sandbox to retrieve
	 * @param config - Optional configuration including connection settings
	 * @returns The Sandbox instance
	 */
	static async getById(
		sandboxId: NonNullable<GetSandboxResponse["id"]>,
		config?: GetSandboxConfig,
	) {
		return withErrorHandler("Failed to get sandbox", async () => {
			const { connection } = config ?? {};
			const client = createClient(connection);

			const sandboxResponse = await client.getSandboxById({
				path: { id: sandboxId },
			});

			if (!sandboxResponse) {
				throw new Error(`Sandbox with ID '${sandboxId}' not found`);
			}

			return new Sandbox(sandboxResponse, client, PRIVATE_CONSTRUCTOR_KEY);
		});
	}

	/**
	 * List all sandboxes in the workspace
	 *
	 * Returns a simplified view of each sandbox (id, identifier, name, status, urls)
	 * rather than full Sandbox instances. Use `getById()` or `getByIdentifier()`
	 * to get a full Sandbox instance for a specific sandbox.
	 *
	 * @param config - Optional configuration including connection settings
	 * @returns Array of simplified sandbox objects
	 */
	static async list(config?: ListSandboxesConfig): Promise<SandboxIdView[]> {
		return withErrorHandler("Failed to list sandboxes", async () => {
			const { connection } = config ?? {};
			const client = createClient(connection);

			const sandboxList = await client.getSandboxes({});
			return sandboxList?.sandboxes ?? [];
		});
	}

	/**
	 * Execute a command in the sandbox
	 * @returns Command instance (call wait() for blocking execution)
	 */
	async runCommand(options: RunCommandOptions): Promise<Command> {
		const sandboxId = this.initializedId;
		return withErrorHandler("Failed to run command", async () => {
			const { stdout, stderr, detached, ...commandRequest } = options;

			// undefined = use default, null = disable, Writable = use that stream
			const outputStdout = stdout === null ? null : (stdout ?? process.stdout);
			const outputStderr = stderr === null ? null : (stderr ?? process.stderr);

			logger.debug(`Executing command: $ ${commandRequest.command}`);

			const commandResponse = await this.#client.executeCommand({
				body: commandRequest,
				path: { sandbox_id: sandboxId },
			});

			const command = new Command({
				commandResponse,
				client: this.#client,
				sandboxId,
			});

			const streamingPromise =
				outputStdout || outputStderr
					? (async () => {
							for await (const log of command.logs({ follow: true })) {
								const output = `${log.data ?? ""}\n`;

								if (log.type === "STDOUT" && outputStdout) {
									outputStdout.write(output);
								} else if (log.type === "STDERR" && outputStderr) {
									outputStderr.write(output);
								}
							}
						})()
					: Promise.resolve();

			if (detached) {
				return command;
			}

			// Wait for both streaming and command completion
			const [finishedCommand] = await Promise.all([
				command.wait(),
				streamingPromise,
			]);
			return finishedCommand;
		});
	}

	/**
	 * Delete the sandbox permanently
	 */
	async destroy(): Promise<void> {
		const sandboxId = this.initializedId;
		return withErrorHandler("Failed to destroy sandbox", async () => {
			await this.#client.deleteSandboxById({ path: { id: sandboxId } });
		});
	}

	/**
	 * Refresh the sandbox data from the API
	 * Updates the internal state with the latest sandbox information
	 */
	async refresh(): Promise<void> {
		const sandboxId = this.initializedId;
		return withErrorHandler("Failed to refresh sandbox", async () => {
			this.#sandboxData = await this.#client.getSandboxById({
				path: { id: sandboxId },
			});
		});
	}

	/**
	 * Wait until the sandbox setup is complete
	 * @param pollIntervalMs - How often to check the status (default: 1000ms)
	 */
	async waitUntilReady(pollIntervalMs = 1000): Promise<void> {
		const sandboxId = this.initializedId;
		return withErrorHandler("Sandbox not ready", async () => {
			while (true) {
				await this.refresh();

				if (this.data.setup_status === "SUCCESS") {
					return;
				}

				if (this.data.setup_status === "FAILED") {
					throw new Error(
						`Sandbox ${sandboxId} setup failed. Status: ${this.data.setup_status}`,
					);
				}

				await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
			}
		});
	}

	/**
	 * Wait until the sandbox is in RUNNING state
	 * @param pollIntervalMs - How often to check the status (default: 1000ms)
	 * @param maxWaitMs - Maximum time to wait before timing out (default: 60000ms)
	 */
	async waitUntilRunning(
		pollIntervalMs = 1000,
		maxWaitMs = 60_000,
	): Promise<void> {
		const sandboxId = this.initializedId;
		return withErrorHandler("Sandbox not running", async () => {
			const startTime = Date.now();

			while (true) {
				await this.refresh();

				if (this.data.status === "RUNNING") {
					return;
				}

				if (this.data.status === "FAILED") {
					throw new Error(
						`Sandbox ${sandboxId} failed. Status: ${this.data.status}`,
					);
				}

				if (Date.now() - startTime > maxWaitMs) {
					throw new Error(
						`Timeout waiting for sandbox ${sandboxId} to be RUNNING. Current: ${this.data.status}`,
					);
				}

				await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
			}
		});
	}

	/**
	 * Wait until the sandbox is in STOPPED state
	 * @param pollIntervalMs - How often to check the status (default: 1000ms)
	 * @param maxWaitMs - Maximum time to wait before timing out (default: 60000ms)
	 */
	async waitUntilStopped(
		pollIntervalMs = 1000,
		maxWaitMs = 60_000,
	): Promise<void> {
		const sandboxId = this.initializedId;
		return withErrorHandler("Sandbox not stopped", async () => {
			const startTime = Date.now();

			while (true) {
				await this.refresh();

				if (this.data.status === "STOPPED") {
					return;
				}

				if (this.data.status === "FAILED") {
					throw new Error(
						`Sandbox ${sandboxId} failed. Status: ${this.data.status}`,
					);
				}

				if (Date.now() - startTime > maxWaitMs) {
					throw new Error(
						`Timeout waiting for sandbox ${sandboxId} to be STOPPED. Current: ${this.data.status}`,
					);
				}

				await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
			}
		});
	}

	/**
	 * Start a stopped sandbox
	 *
	 * If the sandbox is already running, this method returns immediately.
	 * Waits until the sandbox reaches RUNNING state.
	 */
	async start(): Promise<void> {
		const sandboxId = this.initializedId;
		return withErrorHandler("Failed to start sandbox", async () => {
			await this.refresh();

			if (
				this.data.setup_status === "SUCCESS" &&
				this.data.status === "RUNNING"
			) {
				logger.debug(`Sandbox ${sandboxId} is already running.`);
				return;
			}

			logger.debug(`Starting sandbox ${sandboxId}...`);

			this.#sandboxData = await this.#client.startSandbox({
				path: { sandbox_id: sandboxId },
			});

			await this.waitUntilReady();

			logger.debug(
				`Sandbox ${sandboxId} is ready (Setup status: ${this.data.setup_status})`,
			);

			await this.waitUntilRunning();

			logger.debug(
				`Sandbox ${sandboxId} is now running. Status: ${this.data.status}`,
			);
		});
	}

	/**
	 * Stop a running sandbox
	 *
	 * If the sandbox is already stopped, this method returns immediately.
	 * Waits until the sandbox reaches STOPPED state.
	 */
	async stop(): Promise<void> {
		const sandboxId = this.initializedId;
		return withErrorHandler("Failed to stop sandbox", async () => {
			await this.refresh();

			if (this.data.status === "STOPPED") {
				logger.debug(`Sandbox ${sandboxId} is already stopped.`);
				return;
			}

			logger.debug(`Stopping sandbox ${sandboxId}...`);

			this.#sandboxData = await this.#client.stopSandbox({
				path: { sandbox_id: sandboxId },
			});

			await this.waitUntilStopped();

			logger.debug(
				`Sandbox ${sandboxId} is now stopped. Status: ${this.data.status}`,
			);
		});
	}

	/**
	 * Restart the sandbox
	 *
	 * Waits until the sandbox reaches RUNNING state and setup is complete
	 */
	async restart(): Promise<void> {
		const sandboxId = this.initializedId;
		return withErrorHandler("Failed to restart sandbox", async () => {
			logger.debug(`Restarting sandbox ${sandboxId}...`);

			this.#sandboxData = await this.#client.restartSandbox({
				path: { sandbox_id: sandboxId },
			});

			await this.waitUntilRunning();
			await this.waitUntilReady();

			logger.debug(
				`Sandbox ${sandboxId} has been restarted and is ready. Status: ${this.data.status}, Setup status: ${this.data.setup_status}`,
			);
		});
	}

	private constructor(
		sandboxData: NonNullable<GetSandboxResponse>,
		client: BuddyApiClient,
		constructorKey: symbol,
	) {
		if (constructorKey !== PRIVATE_CONSTRUCTOR_KEY) {
			throw new Error(
				`Cannot construct Sandbox directly. ${INITIALIZE_INSTRUCTIONS}`,
			);
		}
		this.#sandboxData = sandboxData;
		this.#client = client;
	}
}
