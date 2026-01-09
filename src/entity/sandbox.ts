import type { Writable } from "node:stream";
import type {
	ICreateSandboxRequest,
	IExecuteSandboxCommandRequest,
	IGetSandboxResponse,
	ISandbox,
} from "@/api/schemas";
import { BuddyApiClient } from "@/core/buddy-api-client";
import { HttpError } from "@/core/http-client";
import { Command, type CommandFinished } from "@/entity/command";
import {
	SandboxCreationError,
	SandboxError,
	SandboxNotFoundError,
	SandboxNotReadyError,
} from "@/errors";
import environment from "@/utils/environment";
import logger from "@/utils/logger";
import {
	API_URLS,
	getApiUrlFromRegion,
	parseRegion,
	type Region,
} from "@/utils/regions";

// Symbol for private constructor protection
const PRIVATE_CONSTRUCTOR_KEY = Symbol("SandboxConstructor");

/**
 * Connection configuration for workspace and API authentication
 */
export interface ConnectionConfig {
	/** Workspace name/slug (falls back to BUDDY_WORKSPACE env var) */
	workspace?: string;
	/** Project name/slug (falls back to BUDDY_PROJECT env var) */
	project?: string;
	/** API authentication token (falls back to BUDDY_TOKEN env var) */
	token?: string;
	/** API region: US, EU, or AP (falls back to BUDDY_REGION env var, default: US) */
	region?: Region;
	/** Custom API URL for testing (not documented, falls back to BUDDY_API_URL env var) */
	apiUrl?: string;
}

/**
 * Configuration for creating a new sandbox
 */
export interface CreateSandboxConfig extends ICreateSandboxRequest {
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
	/** Whether to fetch simplified sandbox data (faster, useful for filtering by ID). Default: false */
	simple?: boolean;
	/** Optional connection configuration to override defaults */
	connection?: ConnectionConfig;
}

/**
 * Options for running a command in the sandbox
 */
interface RunCommandOptions extends IExecuteSandboxCommandRequest {
	/** Stream to write stdout to (default: process.stdout) */
	stdout?: Writable;
	/** Stream to write stderr to (default: process.stderr) */
	stderr?: Writable;
	/** Whether to run the command in detached mode (non-blocking) */
	detached?: boolean;
}

function getConfig(connection?: ConnectionConfig) {
	const workspace = connection?.workspace ?? environment.BUDDY_WORKSPACE;

	if (!workspace) {
		throw new Error(
			"Workspace not found. Set workspace in config.connection or BUDDY_WORKSPACE env var.",
		);
	}

	const project = connection?.project ?? environment.BUDDY_PROJECT;

	if (!project) {
		throw new Error(
			"Project not found. Set project in config.connection or BUDDY_PROJECT env var.",
		);
	}

	let apiUrl: string;

	if (connection?.apiUrl) {
		apiUrl = connection.apiUrl;
	} else if (environment.BUDDY_API_URL) {
		apiUrl = environment.BUDDY_API_URL;
	} else if (connection?.region) {
		const region = parseRegion(connection.region);
		apiUrl = getApiUrlFromRegion(region);
	} else if (environment.BUDDY_REGION) {
		const region = parseRegion(environment.BUDDY_REGION);
		apiUrl = getApiUrlFromRegion(region);
	} else {
		apiUrl = API_URLS.US;
	}

	return {
		workspace,
		projectName: project,
		token: connection?.token,
		apiUrl,
	};
}

function createClient(connection?: ConnectionConfig): BuddyApiClient {
	const { workspace, projectName, token, apiUrl } = getConfig(connection);

	return new BuddyApiClient({
		workspace,
		project_name: projectName,
		apiUrl,
		...(token ? { token } : {}),
	});
}

export class Sandbox {
	#sandboxData?: ISandbox;
	readonly #client: BuddyApiClient;

	/** The unique identifier of the sandbox */
	get id() {
		return this.#sandboxData?.id;
	}

	/** The name of the sandbox */
	get name() {
		return this.#sandboxData?.name;
	}

	/** The current status of the sandbox */
	get status() {
		return this.#sandboxData?.status;
	}

	/** The setup status of the sandbox */
	get setupStatus() {
		return this.#sandboxData?.setup_status;
	}

	#ensureId(): string {
		if (!this.id) {
			throw new SandboxError(
				"Sandbox ID is missing. The sandbox may have been deleted or not properly initialized.",
			);
		}
		return this.id;
	}

	/**
	 * Create a new sandbox or return an existing one if identifier matches
	 * @param config - Sandbox configuration including identifier, name, os, and optional connection settings
	 * @returns A ready-to-use Sandbox instance
	 * @example
	 * ```typescript
	 * const sandbox = await Sandbox.create({
	 *   identifier: "my-sandbox",
	 *   name: "My Sandbox",
	 *   os: "ubuntu:24.04",
	 *   connection: {
	 *     region: "EU"
	 *   }
	 * });
	 * ```
	 */
	static async create(config?: CreateSandboxConfig) {
		const { connection, ...sandboxConfig } = config ?? {};
		const client = createClient(connection);

		if (config?.identifier) {
			const existing = await client.getSandboxByIdentifier(config.identifier);
			if (existing) {
				logger.debug(
					`Found existing sandbox with identifier: ${config.identifier}`,
				);
				return new Sandbox(existing, client, PRIVATE_CONSTRUCTOR_KEY);
			}
		}

		const defaultParameters: ICreateSandboxRequest = {
			name: `Sandbox ${new Date().toISOString()}`,
			identifier: config?.identifier || `sandbox_${String(Date.now())}`,
			os: "ubuntu:24.04",
		};

		// Use provided config if it has sandbox-specific properties, otherwise use defaults
		const hasSandboxConfig = config && Object.keys(sandboxConfig).length > 0;
		const sandboxParameters: ICreateSandboxRequest = hasSandboxConfig
			? (sandboxConfig as ICreateSandboxRequest)
			: defaultParameters;

		let sandboxResponse: IGetSandboxResponse;
		try {
			sandboxResponse = await client.createSandbox(sandboxParameters);
		} catch (error) {
			if (error instanceof HttpError) {
				throw new SandboxCreationError("Failed to create sandbox", error);
			}
			throw error;
		}
		const sandbox = new Sandbox(
			sandboxResponse,
			client,
			PRIVATE_CONSTRUCTOR_KEY,
		);

		logger.debug(`Waiting for sandbox ${sandbox.id} to be ready...`);

		await sandbox.waitUntilReady();

		logger.debug(
			`Sandbox ${sandbox.id} is ready (setupStatus: ${sandbox.setupStatus})`,
		);

		return sandbox;
	}

	/**
	 * Get an existing sandbox by its identifier
	 * @param identifier - The unique identifier of the sandbox to retrieve
	 * @param config - Optional configuration including connection settings
	 * @returns The Sandbox instance
	 * @throws {SandboxNotFoundError} If no sandbox with the given identifier exists
	 * @example
	 * ```typescript
	 * const sandbox = await Sandbox.get("my-sandbox", {
	 *   connection: { region: "EU" }
	 * });
	 * ```
	 */
	static async get(identifier: string, config?: GetSandboxConfig) {
		const { connection } = config ?? {};
		const client = createClient(connection);

		const sandboxResponse = await client.getSandboxByIdentifier(identifier);

		if (!sandboxResponse) {
			throw new SandboxNotFoundError(identifier);
		}

		return new Sandbox(sandboxResponse, client, PRIVATE_CONSTRUCTOR_KEY);
	}

	/**
	 * List all sandboxes in the workspace
	 * @param config - Optional configuration including connection settings and simple mode
	 * @returns Array of sandbox objects (simplified or with get() method depending on simple flag)
	 * @example
	 * ```typescript
	 * // Get full sandbox objects
	 * const sandboxes = await Sandbox.list({
	 *   connection: { region: "EU" }
	 * });
	 *
	 * // Get simplified list (faster)
	 * const simpleSandboxes = await Sandbox.list({
	 *   simple: true
	 * });
	 * ```
	 */
	static async list(config?: ListSandboxesConfig) {
		const { connection, simple } = config ?? {};
		const client = createClient(connection);

		const sandboxList = await client.getSandboxes();
		return (
			sandboxList?.flatMap(async (item) => {
				if (simple) {
					return {
						get: () => {
							return item;
						},
					};
				}

				const fullData = await client.getSandboxById(item.id ?? "");
				if (!fullData) {
					return [];
				}

				return {
					get: () => {
						return new Sandbox(fullData, client, PRIVATE_CONSTRUCTOR_KEY);
					},
				};
			}) ?? []
		);
	}

	/**
	 * Execute a command in the sandbox
	 * @param options - Command execution options including the command string
	 * @returns Promise resolving to Command (detached) or CommandFinished (blocking)
	 */
	async runCommand(
		options: RunCommandOptions & { detached: true },
	): Promise<Command>;

	async runCommand(
		options: RunCommandOptions & { detached?: false },
	): Promise<CommandFinished>;

	async runCommand(
		options: RunCommandOptions,
	): Promise<Command | CommandFinished>;

	async runCommand(
		options: RunCommandOptions,
	): Promise<Command | CommandFinished> {
		const { stdout, stderr, detached, ...commandRequest } = options;

		const outputStdout = stdout ?? process.stdout;
		const outputStderr = stderr ?? process.stderr;

		logger.debug(`Executing command: $ ${commandRequest.command}`);

		const commandResponse = await this.#client.executeCommand(
			this.#ensureId(),
			commandRequest,
		);

		const command = new Command({
			commandResponse,
			client: this.#client,
			sandboxId: this.#ensureId(),
		});

		if (outputStdout || outputStderr) {
			void (async () => {
				for await (const log of command.logs()) {
					if (log.stream === "stdout" && outputStdout) {
						outputStdout.write(log.data);
					} else if (log.stream === "stderr" && outputStderr) {
						outputStderr.write(log.data);
					}
				}
			})();
		}

		return detached ? command : command.wait();
	}

	/**
	 * Delete the sandbox permanently
	 * @throws {SandboxError} If the sandbox ID is missing
	 */
	async destroy(): Promise<void> {
		await this.#client.deleteSandbox(this.#ensureId());
	}

	/**
	 * Get the current status of the sandbox from the API
	 * @returns The sandbox status (RUNNING, STOPPED, FAILED, etc.)
	 */
	async getStatus(): Promise<string> {
		const sandboxResponse = await this.#client.getSandboxById(this.#ensureId());
		return sandboxResponse?.status ?? "unknown";
	}

	/**
	 * Refresh the sandbox data from the API
	 * Updates the internal state with the latest sandbox information
	 */
	async refresh(): Promise<void> {
		this.#sandboxData = (await this.#client.getSandboxById(
			this.#ensureId(),
		)) as ISandbox;
	}

	/**
	 * Wait until the sandbox setup is complete
	 * @param pollIntervalMs - How often to check the status (default: 1000ms)
	 * @throws {SandboxNotReadyError} If the setup fails
	 */
	async waitUntilReady(pollIntervalMs = 1000): Promise<void> {
		while (true) {
			await this.refresh();

			if (this.setupStatus === "SUCCESS") {
				return;
			}

			if (this.setupStatus === "FAILED") {
				throw new SandboxNotReadyError(this.#ensureId(), this.setupStatus);
			}

			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}
	}

	/**
	 * Wait until the sandbox is in RUNNING state
	 * @param pollIntervalMs - How often to check the status (default: 1000ms)
	 * @param maxWaitMs - Maximum time to wait before timing out (default: 60000ms)
	 * @throws {SandboxNotReadyError} If the status becomes FAILED or times out
	 */
	async waitUntilRunning(
		pollIntervalMs = 1000,
		maxWaitMs = 60_000,
	): Promise<void> {
		const startTime = Date.now();

		while (true) {
			await this.refresh();

			if (this.status === "RUNNING") {
				return;
			}

			if (this.status === "FAILED") {
				throw new SandboxNotReadyError(this.#ensureId(), this.status);
			}

			if (Date.now() - startTime > maxWaitMs) {
				throw new SandboxNotReadyError(
					this.#ensureId(),
					`Timeout waiting for RUNNING status. Current: ${this.status}`,
				);
			}

			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}
	}

	/**
	 * Wait until the sandbox is in STOPPED state
	 * @param pollIntervalMs - How often to check the status (default: 1000ms)
	 * @param maxWaitMs - Maximum time to wait before timing out (default: 60000ms)
	 * @throws {SandboxNotReadyError} If the status becomes FAILED or times out
	 */
	async waitUntilStopped(
		pollIntervalMs = 1000,
		maxWaitMs = 60_000,
	): Promise<void> {
		const startTime = Date.now();

		while (true) {
			await this.refresh();

			if (this.status === "STOPPED") {
				return;
			}

			if (this.status === "FAILED") {
				throw new SandboxNotReadyError(this.#ensureId(), this.status);
			}

			if (Date.now() - startTime > maxWaitMs) {
				throw new SandboxNotReadyError(
					this.#ensureId(),
					`Timeout waiting for STOPPED status. Current: ${this.status}`,
				);
			}

			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}
	}

	/**
	 * Start a stopped sandbox
	 * Waits until the sandbox reaches RUNNING state
	 */
	async start(): Promise<void> {
		logger.debug(`Starting sandbox ${this.id}...`);

		this.#sandboxData = (await this.#client.startSandbox(
			this.#ensureId(),
		)) as ISandbox;

		await this.waitUntilRunning();

		logger.debug(`Sandbox ${this.id} is now running. Status: ${this.status}`);
	}

	/**
	 * Stop a running sandbox
	 * Waits until the sandbox reaches STOPPED state
	 */
	async stop(): Promise<void> {
		logger.debug(`Stopping sandbox ${this.id}...`);

		this.#sandboxData = (await this.#client.stopSandbox(
			this.#ensureId(),
		)) as ISandbox;

		await this.waitUntilStopped();

		logger.debug(`Sandbox ${this.id} is now stopped. Status: ${this.status}`);
	}

	/**
	 * Restart the sandbox
	 * Waits until the sandbox reaches RUNNING state and setup is complete
	 */
	async restart(): Promise<void> {
		logger.debug(`Restarting sandbox ${this.id}...`);

		this.#sandboxData = (await this.#client.restartSandbox(
			this.#ensureId(),
		)) as ISandbox;

		await this.waitUntilRunning();
		await this.waitUntilReady();

		logger.debug(
			`Sandbox ${this.id} has been restarted and is ready. Status: ${this.status}, SetupStatus: ${this.setupStatus}`,
		);
	}

	private constructor(
		sandboxData: NonNullable<IGetSandboxResponse>,
		client: BuddyApiClient,
		constructorKey: symbol,
	) {
		if (constructorKey !== PRIVATE_CONSTRUCTOR_KEY) {
			throw new Error(
				"Cannot construct Sandbox directly. Use Sandbox.create(), Sandbox.get(), or Sandbox.list()",
			);
		}
		this.#sandboxData = sandboxData;
		this.#client = client;
	}
}
