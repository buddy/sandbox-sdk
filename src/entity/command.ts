import type { IExecuteSandboxCommandResponse } from "@/api/schemas";
import type { BuddyApiClient } from "@/core/buddy-api-client";

export class Command {
	protected readonly commandResponse: IExecuteSandboxCommandResponse;
	protected readonly client: BuddyApiClient;
	protected readonly sandboxId: string;
	protected readonly commandId: string;

	constructor({
		commandResponse,
		client,
		sandboxId,
	}: {
		commandResponse: IExecuteSandboxCommandResponse;
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

	get status(): string | undefined {
		return this.commandResponse.status;
	}

	get exitCode(): number | undefined {
		return this.commandResponse.exit_code;
	}

	logs() {
		return this.client.streamCommandLogs(this.sandboxId, this.commandId);
	}

	async wait(): Promise<CommandFinished> {
		const finalResponse = await this.pollForCommandCompletion();
		return new CommandFinished({
			commandResponse: finalResponse,
			client: this.client,
			sandboxId: this.sandboxId,
		});
	}

	async output(stream: "stdout" | "stderr" | "both" = "both") {
		let data = "";
		for await (const log of this.logs()) {
			if (stream === "both" || log.stream === stream) {
				data += log.data;
			}
		}
		return data;
	}

	async stdout() {
		return this.output("stdout");
	}

	async stderr() {
		return this.output("stderr");
	}

	async kill() {
		await this.client.terminateCommand(this.sandboxId, this.commandId);
	}

	protected async pollForCommandCompletion(
		pollIntervalMs = 1000,
	): Promise<IExecuteSandboxCommandResponse> {
		while (true) {
			const commandResponse = await this.client.getCommand(
				this.sandboxId,
				this.commandId,
			);

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

export class CommandFinished extends Command {
	private readonly _exitCode: number;

	override get exitCode(): number {
		return this._exitCode;
	}

	constructor({
		commandResponse,
		client,
		sandboxId,
	}: {
		commandResponse: IExecuteSandboxCommandResponse;
		client: BuddyApiClient;
		sandboxId: string;
	}) {
		super({ commandResponse, client, sandboxId });
		this._exitCode = commandResponse.exit_code ?? 0;
	}

	override wait(): Promise<CommandFinished> {
		return Promise.resolve(this);
	}
}
