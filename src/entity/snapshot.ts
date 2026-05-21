import type { SnapshotView } from "@/api/openapi/types.gen";
import type { BuddyApiClient } from "@/core/buddy-api-client";
import { withErrorHandler } from "@/errors";

const PRIVATE_CONSTRUCTOR_KEY = Symbol("SnapshotConstructor");
const INITIALIZE_INSTRUCTIONS =
	"Snapshots are obtained via sandbox.createSnapshot(), sandbox.listSnapshots(), sandbox.getSnapshot(id), or Sandbox.getSnapshotById(sandboxId, snapshotId).";

export class Snapshot {
	#data: SnapshotView;
	readonly #client: BuddyApiClient;
	readonly #sandboxId: string;

	/** The raw snapshot response data from the API */
	get data(): SnapshotView {
		return this.#data;
	}

	/** The snapshot ID, throws if not present */
	get id(): NonNullable<SnapshotView["id"]> {
		const id = this.#data.id;
		if (!id) {
			throw new Error(`Snapshot ID is missing. ${INITIALIZE_INSTRUCTIONS}`);
		}
		return id;
	}

	/** ID of the sandbox this snapshot belongs to */
	get sandboxId(): string {
		return this.#sandboxId;
	}

	/**
	 * Refresh the snapshot data from the API
	 * Updates the internal state with the latest snapshot information
	 */
	async refresh(): Promise<void> {
		return withErrorHandler("Failed to refresh snapshot", async () => {
			this.#data = await this.#client.getSandboxSnapshot({
				path: { sandbox_id: this.#sandboxId, id: this.id },
			});
		});
	}

	/**
	 * Wait until the snapshot reaches CREATED state.
	 *
	 * `sandbox.createSnapshot()` returns immediately with `status: "CREATING"`.
	 * The snapshot cannot be restored until it transitions to `"CREATED"`.
	 *
	 * @param pollIntervalMs - How often to check the status (default: 2000ms (2s))
	 * @param maxWaitMs - Maximum time to wait before timing out (default: 180000ms (180s))
	 */
	async waitUntilReady(
		pollIntervalMs = 2000,
		maxWaitMs = 180_000,
	): Promise<void> {
		return withErrorHandler("Snapshot not ready", async () => {
			const startTime = Date.now();

			while (true) {
				await this.refresh();

				if (this.#data.status === "CREATED") {
					return;
				}

				if (this.#data.status === "FAILED") {
					throw new Error(
						`Snapshot ${this.id} failed. Status: ${this.#data.status}`,
					);
				}

				if (Date.now() - startTime > maxWaitMs) {
					throw new Error(
						`Timeout waiting for snapshot ${this.id} to be CREATED. Current: ${this.#data.status}`,
					);
				}

				await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
			}
		});
	}

	/**
	 * Delete this snapshot permanently
	 */
	async delete(): Promise<void> {
		return withErrorHandler("Failed to delete snapshot", async () => {
			await this.#client.deleteSandboxSnapshot({
				path: { sandbox_id: this.#sandboxId, id: this.id },
			});
		});
	}

	private constructor(
		data: SnapshotView,
		client: BuddyApiClient,
		sandboxId: string,
		constructorKey: symbol,
	) {
		if (constructorKey !== PRIVATE_CONSTRUCTOR_KEY) {
			throw new Error(
				`Cannot construct Snapshot directly. ${INITIALIZE_INSTRUCTIONS}`,
			);
		}
		this.#data = data;
		this.#client = client;
		this.#sandboxId = sandboxId;
	}

	/**
	 * @internal Factory used by the Sandbox class to construct Snapshot instances.
	 */
	static _build(
		data: SnapshotView,
		client: BuddyApiClient,
		sandboxId: string,
	): Snapshot {
		return new Snapshot(data, client, sandboxId, PRIVATE_CONSTRUCTOR_KEY);
	}
}
