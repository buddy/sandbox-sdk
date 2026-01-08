import type { Writable } from "node:stream";
import type {
	IAddSandboxRequest,
	IExecuteSandboxCommandRequest,
	IGetSandboxResponse,
} from "@/api/schemas";
import { BuddyApiClient } from "@/core/buddy-api-client";
import { HttpError } from "@/core/http-client";
import { Command, type CommandFinished } from "@/entity/command";
import {
	SandboxCreationError,
	SandboxNotFoundError,
	SandboxNotReadyError,
} from "@/errors";
import environment from "@/utils/environment";
import logger from "@/utils/logger";

export interface CreateSandboxConfig {
	workspace?: string;
	projectName?: string;
	token?: string;
	apiUrl?: string;
	sandbox?: IAddSandboxRequest;
}

interface RunCommandOptions extends IExecuteSandboxCommandRequest {
	// SDK-specific options for output handling
	stdout?: Writable;
	stderr?: Writable;
	detached?: boolean;
}

function getConfig(config?: CreateSandboxConfig) {
	const workspace = config?.workspace ?? environment.BUDDY_WORKSPACE;

	if (!workspace) {
		throw new Error(
			"Workspace not found. Set workspace name in config or BUDDY_WORKSPACE env var.",
		);
	}

	const projectName = config?.projectName ?? environment.BUDDY_PROJECT_NAME;

	if (!projectName) {
		throw new Error(
			"Project name not found. Set project name in config or BUDDY_PROJECT_NAME env var.",
		);
	}

	return {
		workspace,
		projectName,
		token: config?.token,
		apiUrl: config?.apiUrl ?? environment.BUDDY_API_URL,
	};
}

export class Sandbox {
	private sandboxData: IGetSandboxResponse;
	private readonly client: BuddyApiClient;

	public get sandboxId() {
		return this.sandboxData.id;
	}

	public get name() {
		return this.sandboxData.name;
	}

	public get status() {
		return this.sandboxData.status;
	}

	public get setupStatus() {
		return this.sandboxData.setup_status;
	}

	static async create(config?: CreateSandboxConfig) {
		const { workspace, projectName, token, apiUrl } = getConfig(config);

		const client = new BuddyApiClient({
			workspace,
			debugMode: environment.DEBUG_HTTP,
			...(token ? { token } : {}),
			...(apiUrl ? { apiUrl } : {}),
		});

		if (config?.sandbox?.identifier) {
			const existing = await client.getSandboxByIdentifier(
				projectName,
				config.sandbox.identifier,
			);
			if (existing) {
				logger.debug(
					`Found existing sandbox with identifier: ${config.sandbox.identifier}`,
				);
				return new Sandbox(existing, client);
			}
		}

		const defaultParameters: IAddSandboxRequest = {
			name: `Sandbox ${new Date().toISOString()}`,
			identifier:
				config?.sandbox?.identifier || `sandbox_${String(Date.now())}`,
			os: "ubuntu:24.04",
		};

		const sandboxParameters = config?.sandbox
			? config.sandbox
			: defaultParameters;

		let sandboxResponse: IGetSandboxResponse;
		try {
			sandboxResponse = await client.createSandbox(
				projectName,
				sandboxParameters,
			);
		} catch (error) {
			if (error instanceof HttpError) {
				throw new SandboxCreationError("Failed to create sandbox", error);
			}
			throw error;
		}
		const sandbox = new Sandbox(sandboxResponse, client);

		logger.debug(`Waiting for sandbox ${sandbox.sandboxId} to be ready...`);

		await sandbox.waitUntilReady();

		logger.debug(
			`Sandbox ${sandbox.sandboxId} is ready (setupStatus: ${sandbox.setupStatus})`,
		);

		return sandbox;
	}

	static async get(identifier: string, config?: CreateSandboxConfig) {
		const { workspace, projectName, token, apiUrl } = getConfig(config);

		const client = new BuddyApiClient({
			workspace,
			debugMode: environment.DEBUG_HTTP,
			...(token ? { token } : {}),
			...(apiUrl ? { apiUrl } : {}),
		});

		const sandboxResponse = await client.getSandboxByIdentifier(
			projectName,
			identifier,
		);

		if (!sandboxResponse) {
			throw new SandboxNotFoundError(identifier);
		}

		return new Sandbox(sandboxResponse, client);
	}

	static async list(config?: CreateSandboxConfig) {
		const { workspace, projectName, token, apiUrl } = getConfig(config);

		const client = new BuddyApiClient({
			workspace,
			debugMode: environment.DEBUG_HTTP,
			...(token ? { token } : {}),
			...(apiUrl ? { apiUrl } : {}),
		});

		const sandboxList = await client.listSandboxes(projectName);
		return sandboxList?.map((item) => ({
			get: async () => {
				const fullData = await client.getSandbox(item.id ?? "");
				return new Sandbox(fullData, client);
			},
		}));
	}

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

		const commandResponse = await this.client.executeCommand(
			this.sandboxId,
			commandRequest,
		);

		const command = new Command({
			commandResponse,
			client: this.client,
			sandboxId: this.sandboxId,
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

	async destroy(): Promise<void> {
		await this.client.deleteSandbox(this.sandboxId);
	}

	async getStatus(): Promise<string> {
		const sandboxResponse = await this.client.getSandbox(this.sandboxId);
		return sandboxResponse.status ?? "unknown";
	}

	async refresh(): Promise<void> {
		const sandboxResponse = await this.client.getSandbox(this.sandboxId);
		this.sandboxData = sandboxResponse;
	}

	async waitUntilReady(pollIntervalMs = 1000): Promise<void> {
		while (true) {
			await this.refresh();

			if (this.setupStatus === "SUCCESS") {
				return;
			}

			if (this.setupStatus === "FAILED") {
				throw new SandboxNotReadyError(this.sandboxId, this.setupStatus);
			}

			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}
	}

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
				throw new SandboxNotReadyError(this.sandboxId, this.status);
			}

			if (Date.now() - startTime > maxWaitMs) {
				throw new SandboxNotReadyError(
					this.sandboxId,
					`Timeout waiting for RUNNING status. Current: ${this.status}`,
				);
			}

			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}
	}

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
				throw new SandboxNotReadyError(this.sandboxId, this.status);
			}

			if (Date.now() - startTime > maxWaitMs) {
				throw new SandboxNotReadyError(
					this.sandboxId,
					`Timeout waiting for STOPPED status. Current: ${this.status}`,
				);
			}

			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}
	}

	async start(): Promise<void> {
		logger.debug(`Starting sandbox ${this.sandboxId}...`);

		const response = await this.client.startSandbox(this.sandboxId);
		this.sandboxData = response;

		await this.waitUntilRunning();

		logger.debug(
			`Sandbox ${this.sandboxId} is now running. Status: ${this.status}`,
		);
	}

	async stop(): Promise<void> {
		logger.debug(`Stopping sandbox ${this.sandboxId}...`);

		const response = await this.client.stopSandbox(this.sandboxId);
		this.sandboxData = response;

		await this.waitUntilStopped();

		logger.debug(
			`Sandbox ${this.sandboxId} is now stopped. Status: ${this.status}`,
		);
	}

	async restart(): Promise<void> {
		logger.debug(`Restarting sandbox ${this.sandboxId}...`);

		const response = await this.client.restartSandbox(this.sandboxId);
		this.sandboxData = response;

		await this.waitUntilRunning();
		await this.waitUntilReady();

		logger.debug(
			`Sandbox ${this.sandboxId} has been restarted and is ready. Status: ${this.status}, SetupStatus: ${this.setupStatus}`,
		);
	}

	private constructor(
		sandboxData: IGetSandboxResponse,
		client: BuddyApiClient,
	) {
		this.sandboxData = sandboxData;
		this.client = client;
	}
}
