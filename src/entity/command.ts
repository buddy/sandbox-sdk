import type { ExecView } from "@/api/openapi/types.gen";
import type { BuddyApiClient } from "@/core/buddy-api-client";
import logger from "@/utils/logger";
import { sleep } from "@/utils/poll";

/** How long to let the API hold a status request while waiting (its maximum) */
const WAIT_MS = 25_000;

/** How long to let the API hold a status request between log reads */
const FOLLOW_WAIT_MS = 1_000;

/** The hold grows by this factor up to this cap while the log stays quiet */
const FOLLOW_BACKOFF_FACTOR = 1.5;
const FOLLOW_MAX_WAIT_MS = 5_000;

/** Shortest gap between status requests the API answers without holding */
const MIN_POLL_INTERVAL_MS = 1_000;

/** Log lines per request (the API's maximum) */
const LOG_PAGE_SIZE = 1_000;

/** How long kill() waits for the command to stop after cancelling it */
const KILL_WAIT_MS = 30_000;

/** Any status but INPROGRESS is final, including statuses added later */
function isFinished(response: ExecView) {
	return response.status !== undefined && response.status !== "INPROGRESS";
}

/** Represents a running or completed command execution in a sandbox */
export class Command {
	protected readonly commandResponse: ExecView;
	protected readonly client: BuddyApiClient;
	protected readonly sandboxId: string;
	protected readonly commandId: string;
	/** The final state once seen - it never changes */
	protected finalResponse: ExecView | undefined;

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
		if (isFinished(commandResponse)) this.finalResponse = commandResponse;
	}

	/** The execution ID of the command */
	get id() {
		return this.commandId;
	}

	/** The raw command response data from the API, the final state once seen */
	get data() {
		return this.finalResponse ?? this.commandResponse;
	}

	/** Read the log line by line, stdout and stderr interleaved; `follow` reads until the command finishes */
	async *logs({
		follow = false,
		signal,
	}: {
		follow?: boolean;
		signal?: AbortSignal;
	} = {}): AsyncGenerator<string, void, undefined> {
		let offset = 0n;
		let finished = this.finalResponse !== undefined;
		let reportedTruncation = false;
		let holdMs = FOLLOW_WAIT_MS;

		while (true) {
			let read = 0;
			while (true) {
				const {
					lines = [],
					next_offset,
					truncated,
				} = await this.client.getCommandLog(
					{
						path: { sandbox_id: this.sandboxId, exec_id: this.commandId },
						query: { offset, limit: BigInt(LOG_PAGE_SIZE) },
					},
					{ signal },
				);
				if (truncated && !reportedTruncation) {
					reportedTruncation = true;
					logger.warn(`The log of command ${this.commandId} is truncated`);
				}
				yield* lines;
				read += lines.length;
				offset = next_offset ?? offset + BigInt(lines.length);
				if (lines.length < LOG_PAGE_SIZE) break;
			}

			// One more read after the command finishes picks up its last lines
			if (!follow || finished) return;

			if (read > 0) holdMs = FOLLOW_WAIT_MS;
			finished = isFinished(await this.fetchStatus(holdMs, signal));
			holdMs = Math.min(holdMs * FOLLOW_BACKOFF_FACTOR, FOLLOW_MAX_WAIT_MS);
		}
	}

	/** Wait for the command to finish; `signal` stops the waiting, not the command */
	async wait({ signal }: { signal?: AbortSignal } = {}): Promise<Command> {
		const finalResponse =
			this.finalResponse ?? (await this.waitUntilFinished(signal));
		return new Command({
			commandResponse: finalResponse,
			client: this.client,
			sandboxId: this.sandboxId,
		});
	}

	/** Get all output once the command finishes, stdout and stderr interleaved */
	async output(options: { signal?: AbortSignal } = {}) {
		// Untyped callers of the old output("STDERR") would silently get both streams
		if (options === null || typeof options !== "object") {
			throw new Error(
				"output() takes no stream: stdout and stderr arrive interleaved",
			);
		}

		const { signal } = options;
		let data = "";
		for await (const line of this.logs({ follow: true, signal })) {
			data += `${line}\n`;
		}
		return data;
	}

	/** Cancel the command and wait up to 30s for it to stop */
	async kill() {
		if (this.finalResponse) return;
		await this.client.cancelCommand({
			path: { sandbox_id: this.sandboxId, exec_id: this.commandId },
		});

		const deadline = AbortSignal.timeout(KILL_WAIT_MS);
		try {
			await this.waitUntilFinished(deadline);
		} catch (error) {
			if (!deadline.aborted) throw error;
		}
	}

	/** Hold status requests on the API until the command reaches a final state */
	protected async waitUntilFinished(signal?: AbortSignal): Promise<ExecView> {
		while (true) {
			const response = await this.fetchStatus(WAIT_MS, signal);
			if (isFinished(response)) return response;
		}
	}

	/** Fetch the status, held up to `waitMs`; an early unfinished answer is padded so loops don't spin */
	protected async fetchStatus(
		waitMs: number,
		signal?: AbortSignal,
	): Promise<ExecView> {
		const startedAt = Date.now();
		const response = await this.client.getCommandDetails(
			{
				path: { sandbox_id: this.sandboxId, exec_id: this.commandId },
				query: { wait: BigInt(Math.round(waitMs)) },
			},
			{ signal },
		);

		if (isFinished(response)) {
			this.finalResponse = response;
		} else {
			const elapsed = Date.now() - startedAt;
			const floor = Math.min(waitMs, MIN_POLL_INTERVAL_MS);
			if (elapsed < floor) await sleep(floor - elapsed, signal);
		}

		return response;
	}
}
