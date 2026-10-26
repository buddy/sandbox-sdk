import type { ExecView } from "@/api/openapi/types.gen";
import type { BuddyApiClient } from "@/core/buddy-api-client";
import { sleep } from "@/utils/poll";

/** How long to let the API hold a status request while waiting (its maximum) */
const WAIT_MS = 25_000;

/** How long to let the API hold a status request between log reads */
const FOLLOW_WAIT_MS = 1_000;

/** Shortest gap between status requests the API answers without holding */
const MIN_POLL_INTERVAL_MS = 1_000;

/** Log lines per request (the API's maximum) */
const LOG_PAGE_SIZE = 1_000;

/** Anything but INPROGRESS is final, including statuses added later */
function isFinished(response: ExecView) {
	return response.status !== "INPROGRESS";
}

/** Represents a running or completed command execution in a sandbox */
export class Command {
	protected readonly commandResponse: ExecView;
	protected readonly client: BuddyApiClient;
	protected readonly sandboxId: string;
	protected readonly commandId: string;

	/** Create a new Command instance from an API response */
	constructor({
		commandResponse,
		client,
		sandboxId,
	}: {
		commandResponse: ExecView;
		client: BuddyApiClient;
		sandboxId: string;
	}) {
		if (!commandResponse.execution_id) {
			throw new Error("Command response must have an execution_id");
		}
		this.commandResponse = commandResponse;
		this.client = client;
		this.sandboxId = sandboxId;
		this.commandId = commandResponse.execution_id;
	}

	/** The execution ID of the command */
	get id() {
		return this.commandId;
	}

	/** The raw command response data from the API */
	get data() {
		return this.commandResponse;
	}

	/**
	 * Read the command's log line by line. stdout and stderr arrive
	 * interleaved in a single log.
	 * @param follow Keep reading until the command finishes
	 */
	async *logs({
		follow = false,
	}: {
		follow?: boolean;
	} = {}): AsyncGenerator<string, void, undefined> {
		let offset = 0n;
		let finished = false;

		while (true) {
			while (true) {
				const { lines = [], next_offset } = await this.client.getCommandLog({
					path: { sandbox_id: this.sandboxId, exec_id: this.commandId },
					query: { offset, limit: BigInt(LOG_PAGE_SIZE) },
				});
				yield* lines;
				offset = next_offset ?? offset + BigInt(lines.length);
				if (lines.length < LOG_PAGE_SIZE) break;
			}

			// One more read after the command finishes picks up its last lines
			if (!follow || finished) return;
			finished = isFinished(await this.fetchStatus(FOLLOW_WAIT_MS));
		}
	}

	/**
	 * Wait for the command to finish execution
	 * @returns Command instance with final response data
	 */
	async wait(): Promise<Command> {
		const finalResponse = await this.waitUntilFinished();
		return new Command({
			commandResponse: finalResponse,
			client: this.client,
			sandboxId: this.sandboxId,
		});
	}

	/**
	 * Get all output from the command (waits for completion)
	 * @returns stdout and stderr, interleaved as the command wrote them
	 */
	async output() {
		let data = "";
		for await (const line of this.logs({ follow: true })) {
			data += `${line}\n`;
		}
		return data;
	}

	/** Cancel the running command and wait until it has stopped */
	async kill() {
		await this.client.cancelCommand({
			path: { sandbox_id: this.sandboxId, exec_id: this.commandId },
		});
		await this.waitUntilFinished();
	}

	/**
	 * Hold status requests on the API until the command reaches a final state
	 * @returns Final command response
	 */
	protected async waitUntilFinished(): Promise<ExecView> {
		while (true) {
			const response = await this.fetchStatus(WAIT_MS);
			if (isFinished(response)) return response;
		}
	}

	/**
	 * Fetch the command's status, letting the API hold the request up to
	 * `waitMs` for it to finish. The API skips the hold when it is busy, so an
	 * unfinished answer that comes back early is padded to keep loops calm.
	 */
	protected async fetchStatus(waitMs: number): Promise<ExecView> {
		const startedAt = Date.now();
		const response = await this.client.getCommandDetails({
			path: { sandbox_id: this.sandboxId, exec_id: this.commandId },
			query: { wait: BigInt(waitMs) },
		});

		if (!isFinished(response)) {
			const elapsed = Date.now() - startedAt;
			const floor = Math.min(waitMs, MIN_POLL_INTERVAL_MS);
			if (elapsed < floor) await sleep(floor - elapsed);
		}

		return response;
	}
}
