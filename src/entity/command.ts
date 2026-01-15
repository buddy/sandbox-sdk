import type { ExecuteSandboxCommandResponse } from "@/api/openapi";
import type { BuddyApiClient } from "@/core/buddy-api-client";

/** Represents a running or completed command execution in a sandbox */
export class Command {
	protected readonly commandResponse: ExecuteSandboxCommandResponse;
	protected readonly client: BuddyApiClient;
	protected readonly sandboxId: string;
	protected readonly commandId: string;

	/** Create a new Command instance from an API response */
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

	/** The raw command response data from the API */
	get data() {
		return this.commandResponse;
	}

	/**
	 * Stream logs from the command in real-time
	 * @returns AsyncGenerator yielding log entries with type and data
	 */
	logs({ follow }: { follow?: boolean } = {}) {
		return this.client.streamCommandLogs({
			path: { command_id: this.commandId, sandbox_id: this.sandboxId },
			query: { follow },
		});
	}

	/**
	 * Wait for the command to finish execution
	 * @returns Command instance with final response data
	 */
	async wait(): Promise<Command> {
		const finalResponse = await this.pollForCommandCompletion();
		return new Command({
			commandResponse: finalResponse,
			client: this.client,
			sandboxId: this.sandboxId,
		});
	}

	/**
	 * Get all output from the command (waits for completion)
	 * @returns Complete output as a string
	 */
	async output(stream: "STDOUT" | "STDERR" | "BOTH" = "BOTH") {
		let data = "";
		for await (const log of this.logs({ follow: true })) {
			if (stream === "BOTH" || log.type === stream) {
				data += `${log.data ?? ""}\n`;
			}
		}
		return data;
	}

	/**
	 * Get all stdout output from the command (waits for completion)
	 * @returns Stdout as a string
	 */
	async stdout() {
		return this.output("STDOUT");
	}

	/**
	 * Get all stderr output from the command (waits for completion)
	 * @returns Stderr as a string
	 */
	async stderr() {
		return this.output("STDERR");
	}

	/** Terminate the running command */
	async kill() {
		await this.client.terminateCommand({
			path: {
				sandbox_id: this.sandboxId,
				command_id: this.commandId,
			},
		});
	}

	/**
	 * Poll the API until the command reaches a terminal state
	 * @returns Final command response
	 */
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
