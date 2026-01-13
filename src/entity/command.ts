import type { ExecuteSandboxCommandResponse } from "@/api/openapi";
import type { BuddyApiClient } from "@/core/buddy-api-client";

export class Command {
	protected readonly commandResponse: ExecuteSandboxCommandResponse;
	protected readonly client: BuddyApiClient;
	protected readonly sandboxId: string;
	protected readonly commandId: string;

	constructor({
		commandResponse,
		client,
		sandboxId,
	}: {
		commandResponse: ExecuteSandboxCommandResponse;
		client: BuddyApiClient;
		sandboxId: string;
	}) {
		if (!commandResponse.id) {
			throw new Error("Command response must have an id");
		}
		this.commandResponse = commandResponse;
		this.client = client;
		this.sandboxId = sandboxId;
		this.commandId = commandResponse.id;
	}

	/** The current status of the command (RUNNING, SUCCESSFUL, FAILED, etc.) */
	get status(): string | undefined {
		return this.commandResponse.status;
	}

	/** The exit code of the command (undefined if still running) */
	get exitCode(): number | undefined {
		return this.commandResponse.exit_code;
	}

	/**
	 * Stream logs from the command in real-time
	 * @param options - Options for log streaming
	 * @param options.follow - If true, streams logs until the command completes
	 * @returns AsyncIterableIterator that yields log entries with stream ("stdout" or "stderr") and data
	 */
	logs({ follow }: { follow?: boolean } = {}) {
		return this.client.streamCommandLogs({
			path: { command_id: this.commandId, sandbox_id: this.sandboxId },
			query: { follow },
		});
	}

	/**
	 * Wait for the command to finish execution
	 * @returns Promise resolving to CommandFinished when the command completes
	 */
	async wait(): Promise<CommandFinished> {
		const finalResponse = await this.pollForCommandCompletion();
		return new CommandFinished({
			commandResponse: finalResponse,
			client: this.client,
			sandboxId: this.sandboxId,
		});
	}

	/**
	 * Get all output from the command
	 * @param stream - Which output stream(s) to capture: "stdout", "stderr", or "both"
	 * @returns Promise resolving to the complete output as a string
	 */
	async output(stream: "STDOUT" | "STDERR" | "BOTH" = "BOTH") {
		let data = "";
		for await (const log of this.logs()) {
			if (stream === "BOTH" || log.type === stream) {
				data += log.data;
			}
		}
		return data;
	}

	/**
	 * Get all stdout output from the command
	 * @returns Promise resolving to stdout as a string
	 */
	async stdout() {
		return this.output("STDOUT");
	}

	/**
	 * Get all stderr output from the command
	 * @returns Promise resolving to stderr as a string
	 */
	async stderr() {
		return this.output("STDERR");
	}

	/**
	 * Terminate the running command
	 */
	async kill() {
		await this.client.terminateCommand({
			path: {
				sandbox_id: this.sandboxId,
				command_id: this.commandId,
			},
		});
	}

	protected async pollForCommandCompletion(
		pollIntervalMs = 1000,
	): Promise<ExecuteSandboxCommandResponse> {
		while (true) {
			const commandResponse = await this.client.getCommandDetails({
				path: {
					sandbox_id: this.sandboxId,
					id: this.commandId,
				},
			});

			if (
				commandResponse.status === "SUCCESSFUL" ||
				commandResponse.status === "FAILED"
			) {
				return commandResponse;
			}

			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}
	}
}

/**
 * Represents a command that has finished execution
 * Provides the same API as Command but with guaranteed exit code
 */
export class CommandFinished extends Command {
	readonly #_exitCode: number;

	/** The exit code of the finished command (always defined) */
	override get exitCode(): number {
		return this.#_exitCode;
	}

	constructor({
		commandResponse,
		client,
		sandboxId,
	}: {
		commandResponse: ExecuteSandboxCommandResponse;
		client: BuddyApiClient;
		sandboxId: string;
	}) {
		super({ commandResponse, client, sandboxId });
		this.#_exitCode = commandResponse.exit_code ?? 0;
	}

	/**
	 * Returns immediately since the command is already finished
	 * @returns Promise resolving to this CommandFinished instance
	 */
	override wait(): Promise<CommandFinished> {
		return Promise.resolve(this);
	}
}
