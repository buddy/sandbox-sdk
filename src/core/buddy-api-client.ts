import { prettifyError, type z } from "zod";
import {
	addSandboxResponseTransformer,
	addSandboxSnapshotResponseTransformer,
	createSandboxDirectoryResponseTransformer,
	executeSandboxResponseTransformer,
	getProjectSnapshotsResponseTransformer,
	getSandboxContentResponseTransformer,
	getSandboxExecLogResponseTransformer,
	getSandboxExecResponseTransformer,
	getSandboxResponseTransformer,
	getSandboxSnapshotResponseTransformer,
	getSandboxSnapshotsResponseTransformer,
	listSandboxExecsResponseTransformer,
	restartSandboxResponseTransformer,
	startSandboxAppResponseTransformer,
	startSandboxResponseTransformer,
	stopSandboxAppResponseTransformer,
	stopSandboxResponseTransformer,
	updateSandboxResponseTransformer,
	uploadSandboxFileResponseTransformer,
} from "@/api/openapi/transformers.gen";
import type {
	AddSandboxData,
	AddSandboxResponse,
	AddSandboxSnapshotData,
	AddSandboxSnapshotResponse,
	CancelSandboxExecData,
	CancelSandboxExecResponse,
	CreateSandboxDirectoryData,
	CreateSandboxDirectoryResponse,
	DeleteSandboxData,
	DeleteSandboxFileData,
	DeleteSandboxFileResponse,
	DeleteSandboxResponse,
	DeleteSandboxSnapshotData,
	DeleteSandboxSnapshotResponse,
	DeleteSnapshotData,
	DeleteSnapshotResponse,
	DownloadSandboxContentData,
	ExecSandboxCommandData,
	ExecSandboxCommandResponse,
	ExecuteSandboxData,
	ExecuteSandboxResponse,
	GetIdentifiersData,
	GetIdentifiersResponse,
	GetProjectSnapshotsData,
	GetProjectSnapshotsResponse,
	GetSandboxAppLogsByIdData,
	GetSandboxAppLogsByIdResponse,
	GetSandboxContentData,
	GetSandboxContentResponse,
	GetSandboxData,
	GetSandboxExecData,
	GetSandboxExecLogData,
	GetSandboxExecLogResponse,
	GetSandboxExecResponse,
	GetSandboxesData,
	GetSandboxesResponse,
	GetSandboxResponse,
	GetSandboxSnapshotData,
	GetSandboxSnapshotResponse,
	GetSandboxSnapshotsData,
	GetSandboxSnapshotsResponse,
	ListSandboxExecsData,
	ListSandboxExecsResponse,
	RestartSandboxData,
	RestartSandboxResponse,
	StartSandboxAppData,
	StartSandboxAppResponse,
	StartSandboxData,
	StartSandboxResponse,
	StopSandboxAppData,
	StopSandboxAppResponse,
	StopSandboxData,
	StopSandboxResponse,
	UpdateSandboxData,
	UpdateSandboxResponse,
	UploadSandboxFileData,
	UploadSandboxFileResponse,
} from "@/api/openapi/types.gen";
import {
	zAddSandboxBody,
	zAddSandboxPath,
	zAddSandboxQuery,
	zAddSandboxResponse,
	zAddSandboxSnapshotBody,
	zAddSandboxSnapshotPath,
	zAddSandboxSnapshotResponse,
	zCancelSandboxExecPath,
	zCancelSandboxExecResponse,
	zCreateSandboxDirectoryPath,
	zCreateSandboxDirectoryResponse,
	zDeleteSandboxFilePath,
	zDeleteSandboxFileResponse,
	zDeleteSandboxPath,
	zDeleteSandboxResponse,
	zDeleteSandboxSnapshotPath,
	zDeleteSandboxSnapshotResponse,
	zDeleteSnapshotPath,
	zDeleteSnapshotResponse,
	zDownloadSandboxContentPath,
	zExecSandboxCommandBody,
	zExecSandboxCommandPath,
	zExecSandboxCommandResponse,
	zExecuteSandboxBody,
	zExecuteSandboxPath,
	zExecuteSandboxResponse,
	zGetIdentifiersPath,
	zGetIdentifiersQuery,
	zGetIdentifiersResponse,
	zGetProjectSnapshotsPath,
	zGetProjectSnapshotsQuery,
	zGetProjectSnapshotsResponse,
	zGetSandboxAppLogsByIdPath,
	zGetSandboxAppLogsByIdQuery,
	zGetSandboxAppLogsByIdResponse,
	zGetSandboxContentPath,
	zGetSandboxContentResponse,
	zGetSandboxExecLogPath,
	zGetSandboxExecLogQuery,
	zGetSandboxExecLogResponse,
	zGetSandboxExecPath,
	zGetSandboxExecQuery,
	zGetSandboxExecResponse,
	zGetSandboxesPath,
	zGetSandboxesQuery,
	zGetSandboxesResponse,
	zGetSandboxPath,
	zGetSandboxResponse,
	zGetSandboxSnapshotPath,
	zGetSandboxSnapshotResponse,
	zGetSandboxSnapshotsPath,
	zGetSandboxSnapshotsResponse,
	zListSandboxExecsPath,
	zListSandboxExecsQuery,
	zListSandboxExecsResponse,
	zRestartSandboxPath,
	zRestartSandboxResponse,
	zStartSandboxAppPath,
	zStartSandboxAppResponse,
	zStartSandboxPath,
	zStartSandboxResponse,
	zStopSandboxAppPath,
	zStopSandboxAppResponse,
	zStopSandboxPath,
	zStopSandboxResponse,
	zUpdateSandboxBody,
	zUpdateSandboxPath,
	zUpdateSandboxResponse,
	zUploadSandboxFilePath,
	zUploadSandboxFileResponse,
} from "@/api/openapi/zod.gen";
import {
	HttpClient,
	type HttpClientConfig,
	HttpError,
	type HttpResponse,
	type RequestConfig,
} from "@/core/http-client";
import type { ClientData, Data, DataUrl, QueryValue } from "@/types";
import environment from "@/utils/environment";
import logger from "@/utils/logger";

/** Configuration options for creating a BuddyApiClient instance */
export interface BuddyApiConfig extends Omit<HttpClientConfig, "baseURL"> {
	/** Buddy workspace domain (e.g. "mycompany") */
	workspace: string;
	/** Project name within the workspace */
	project_name: string;
	/** API authentication token (falls back to BUDDY_TOKEN env var) */
	token?: string;
	/** Base URL of the Buddy API */
	apiUrl: string;
}

/** The API fails a synchronous command at 60s - outlast it, barely */
const EXEC_TIMEOUT_MS = 65_000;

/** The API holds a command status request for at most 25s - outlast it */
const WAIT_TIMEOUT_MS = 35_000;

/** API client for Buddy sandbox operations with request validation and response transformation */
export class BuddyApiClient extends HttpClient {
	readonly workspace: BuddyApiConfig["workspace"];
	readonly project_name: BuddyApiConfig["project_name"];
	readonly #apiUrl: BuddyApiConfig["apiUrl"];
	readonly #token: BuddyApiConfig["token"];

	/** Builds a parameterized URL by replacing path placeholders */
	#buildUrl<const D extends Pick<Data, "url">>(params: {
		path?: Record<string, string>;
		url: DataUrl<D>;
	}): string {
		const { path = {}, url } = params;
		return url.replace(/{(\w+)}/g, (_, key: string) => {
			const value = path[key];
			if (value === undefined) {
				throw new Error(`Missing path parameter: ${key}`);
			}
			return value;
		});
	}

	/** Parse and validate HTTP response data against a Zod schema */
	async #parseResponse<T>(
		schema: z.ZodType<T>,
		response: HttpResponse,
	): Promise<T> {
		const result = await schema.safeParseAsync(response.data);

		if (!result.success) {
			const prettyError = prettifyError(result.error);
			throw new HttpError(
				`Response validation failed:\n${prettyError}`,
				response.status,
				response,
			);
		}

		return result.data;
	}

	/** Execute an HTTP request with input/output validation */
	async #requestWithValidation<const D extends Data, Response>({
		method,
		url,
		data,
		bodySchema,
		pathSchema,
		querySchema,
		responseSchema,
		skipRetry,
		idempotent,
		timeoutMs,
		signal,
	}: {
		method: "GET" | "POST" | "DELETE" | "PATCH";
		url: DataUrl<D>;
		data: ClientData<D>;
		bodySchema?: z.ZodType;
		pathSchema: z.ZodType;
		querySchema?: z.ZodType;
		responseSchema: z.ZodType<Response>;
		skipRetry?: boolean;
		/** See `RequestConfig.idempotent`; creates and command runs pass `false`. */
		idempotent?: boolean;
		/** See `RequestConfig.timeoutMs`; a blocking exec outlives the default. */
		timeoutMs?: number;
		/** See `RequestConfig.signal` */
		signal?: AbortSignal;
	}): Promise<Response> {
		const pathResult = await pathSchema.safeParseAsync({
			workspace_domain: this.workspace,
			...(data.path ?? {}),
		});
		if (!pathResult.success) {
			throw pathResult.error;
		}
		const validatedPath = pathResult.data as Record<string, string>;

		let validatedQuery: Record<string, QueryValue> | undefined;
		if (querySchema) {
			const queryResult = await querySchema.safeParseAsync({
				project_name: this.project_name,
				...(data.query ?? {}),
			});
			if (!queryResult.success) {
				throw queryResult.error;
			}
			validatedQuery = queryResult.data as Record<string, QueryValue>;
		}

		let validatedBody: unknown = data.body;
		if (bodySchema && data.body !== undefined) {
			const bodyResult = await bodySchema.safeParseAsync(data.body);
			if (!bodyResult.success) {
				throw bodyResult.error;
			}
			validatedBody = bodyResult.data;
		}

		const parameterizedUrl = this.#buildUrl<D>({
			url,
			path: validatedPath,
		});

		const requestConfig: RequestConfig = {
			queryParams: validatedQuery,
			skipRetry,
			idempotent,
			timeoutMs,
			signal,
		};

		let request: Promise<HttpResponse>;

		switch (method) {
			case "POST": {
				request = this.post(
					parameterizedUrl,
					validatedBody ?? {},
					requestConfig,
				);
				break;
			}
			case "GET": {
				request = this.get(parameterizedUrl, requestConfig);
				break;
			}
			case "DELETE": {
				request = this.delete(parameterizedUrl, requestConfig);
				break;
			}
			case "PATCH": {
				request = this.patch(
					parameterizedUrl,
					validatedBody ?? {},
					requestConfig,
				);
				break;
			}
		}

		const response = await request;
		return (await this.#parseResponse(responseSchema, response)) as Response;
	}

	/** Create a new sandbox */
	async addSandbox<const Data extends AddSandboxData>(data: ClientData<Data>) {
		return this.#requestWithValidation<Data, AddSandboxResponse>({
			method: "POST",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes",
			idempotent: false,
			bodySchema: zAddSandboxBody,
			pathSchema: zAddSandboxPath,
			querySchema: zAddSandboxQuery,
			responseSchema: zAddSandboxResponse.transform(
				addSandboxResponseTransformer,
			),
		});
	}

	/** Update an existing sandbox's configuration (timeout, apps, endpoints, etc.) */
	async updateSandbox<const Data extends UpdateSandboxData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, UpdateSandboxResponse>({
			method: "PATCH",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{id}",
			bodySchema: zUpdateSandboxBody,
			pathSchema: zUpdateSandboxPath,
			responseSchema: zUpdateSandboxResponse.transform(
				updateSandboxResponseTransformer,
			),
		});
	}

	/** List snapshots for a sandbox */
	async getSandboxSnapshots<const Data extends GetSandboxSnapshotsData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, GetSandboxSnapshotsResponse>({
			method: "GET",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/snapshots",
			pathSchema: zGetSandboxSnapshotsPath,
			responseSchema: zGetSandboxSnapshotsResponse.transform(
				getSandboxSnapshotsResponseTransformer,
			),
		});
	}

	/** List all snapshots in the project (across all sandboxes, including orphans) */
	async getProjectSnapshots<const Data extends GetProjectSnapshotsData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, GetProjectSnapshotsResponse>({
			method: "GET",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/snapshots",
			pathSchema: zGetProjectSnapshotsPath,
			querySchema: zGetProjectSnapshotsQuery,
			responseSchema: zGetProjectSnapshotsResponse.transform(
				getProjectSnapshotsResponseTransformer,
			),
		});
	}

	/** Create a snapshot of a sandbox */
	async addSandboxSnapshot<const Data extends AddSandboxSnapshotData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, AddSandboxSnapshotResponse>({
			method: "POST",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/snapshots",
			idempotent: false,
			bodySchema: zAddSandboxSnapshotBody,
			pathSchema: zAddSandboxSnapshotPath,
			responseSchema: zAddSandboxSnapshotResponse.transform(
				addSandboxSnapshotResponseTransformer,
			),
		});
	}

	/** Get a single sandbox snapshot by ID */
	async getSandboxSnapshot<const Data extends GetSandboxSnapshotData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, GetSandboxSnapshotResponse>({
			method: "GET",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/snapshots/{id}",
			pathSchema: zGetSandboxSnapshotPath,
			responseSchema: zGetSandboxSnapshotResponse.transform(
				getSandboxSnapshotResponseTransformer,
			),
		});
	}

	/** Delete a sandbox snapshot by ID */
	async deleteSandboxSnapshot<const Data extends DeleteSandboxSnapshotData>(
		data: ClientData<Data>,
	) {
		try {
			return await this.#requestWithValidation<
				Data,
				DeleteSandboxSnapshotResponse
			>({
				method: "DELETE",
				data,
				url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/snapshots/{id}",
				pathSchema: zDeleteSandboxSnapshotPath,
				responseSchema: zDeleteSandboxSnapshotResponse,
				skipRetry: true,
			});
		} catch (error) {
			// Ignore 404 errors - snapshot already deleted
			if (error instanceof HttpError && error.status === 404) {
				return;
			}
			throw error;
		}
	}

	/**
	 * Delete a snapshot by ID at the project level (works for snapshots whose
	 * parent sandbox has been deleted).
	 */
	async deleteSnapshot<const Data extends DeleteSnapshotData>(
		data: ClientData<Data>,
	) {
		try {
			return await this.#requestWithValidation<Data, DeleteSnapshotResponse>({
				method: "DELETE",
				data,
				url: "/workspaces/{workspace_domain}/sandboxes/snapshots/{id}",
				pathSchema: zDeleteSnapshotPath,
				responseSchema: zDeleteSnapshotResponse,
				skipRetry: true,
			});
		} catch (error) {
			// Ignore 404 errors - snapshot already deleted
			if (error instanceof HttpError && error.status === 404) {
				return;
			}
			throw error;
		}
	}

	/** Get a specific sandbox by its ID */
	async getSandboxById<const Data extends GetSandboxData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, GetSandboxResponse>({
			method: "GET",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{id}",
			pathSchema: zGetSandboxPath,
			responseSchema: zGetSandboxResponse.transform(
				getSandboxResponseTransformer,
			),
		});
	}

	/** Get a specific sandbox by its ID */
	async getIdentifiers<const Data extends GetIdentifiersData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, GetIdentifiersResponse>({
			method: "GET",
			data,
			url: "/workspaces/{workspace_domain}/identifiers",
			pathSchema: zGetIdentifiersPath,
			querySchema: zGetIdentifiersQuery,
			responseSchema: zGetIdentifiersResponse,
		});
	}

	/** Execute a command in a sandbox, returning once it has been accepted */
	async executeCommand<const Data extends ExecuteSandboxData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, ExecuteSandboxResponse>({
			method: "POST",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/execs",
			idempotent: false,
			bodySchema: zExecuteSandboxBody,
			pathSchema: zExecuteSandboxPath,
			responseSchema: zExecuteSandboxResponse.transform(
				executeSandboxResponseTransformer,
			),
		});
	}

	/**
	 * Run a command in a sandbox and wait for its result. The request stays
	 * open for as long as the command runs, so it outlasts the API's own 60
	 * second ceiling by default rather than the client-wide timeout.
	 */
	async execCommand<const Data extends ExecSandboxCommandData>(
		data: ClientData<Data>,
		options: { timeoutMs?: number } = {},
	) {
		return this.#requestWithValidation<Data, ExecSandboxCommandResponse>({
			method: "POST",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/exec",
			idempotent: false,
			bodySchema: zExecSandboxCommandBody,
			pathSchema: zExecSandboxCommandPath,
			responseSchema: zExecSandboxCommandResponse,
			timeoutMs: options.timeoutMs ?? EXEC_TIMEOUT_MS,
		});
	}

	/** List the most recent command executions in a sandbox, newest first */
	async getSandboxCommands<const Data extends ListSandboxExecsData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, ListSandboxExecsResponse>({
			method: "GET",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/execs",
			pathSchema: zListSandboxExecsPath,
			querySchema: zListSandboxExecsQuery,
			responseSchema: zListSandboxExecsResponse.transform(
				listSandboxExecsResponseTransformer,
			),
		});
	}

	/** Get a command execution, held by the API for up to `wait` ms until it finishes */
	async getCommandDetails<const Data extends GetSandboxExecData>(
		data: ClientData<Data>,
		options: { signal?: AbortSignal } = {},
	) {
		return this.#requestWithValidation<Data, GetSandboxExecResponse>({
			method: "GET",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/execs/{exec_id}",
			pathSchema: zGetSandboxExecPath,
			querySchema: zGetSandboxExecQuery,
			responseSchema: zGetSandboxExecResponse.transform(
				getSandboxExecResponseTransformer,
			),
			timeoutMs: WAIT_TIMEOUT_MS,
			signal: options.signal,
		});
	}

	/** Get a slice of a command execution's log */
	async getCommandLog<const Data extends GetSandboxExecLogData>(
		data: ClientData<Data>,
		options: { signal?: AbortSignal } = {},
	) {
		return this.#requestWithValidation<Data, GetSandboxExecLogResponse>({
			method: "GET",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/execs/{exec_id}/log",
			pathSchema: zGetSandboxExecLogPath,
			querySchema: zGetSandboxExecLogQuery,
			responseSchema: zGetSandboxExecLogResponse.transform(
				getSandboxExecLogResponseTransformer,
			),
			signal: options.signal,
		});
	}

	/** Cancel a running command in a sandbox, without waiting for it to stop */
	async cancelCommand<const Data extends CancelSandboxExecData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, CancelSandboxExecResponse>({
			method: "DELETE",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/execs/{exec_id}",
			pathSchema: zCancelSandboxExecPath,
			responseSchema: zCancelSandboxExecResponse,
		});
	}

	/** Delete a sandbox by its ID */
	async deleteSandboxById<const Data extends DeleteSandboxData>(
		data: ClientData<Data>,
	) {
		try {
			return await this.#requestWithValidation<Data, DeleteSandboxResponse>({
				method: "DELETE",
				data,
				url: "/workspaces/{workspace_domain}/sandboxes/{id}",
				pathSchema: zDeleteSandboxPath,
				responseSchema: zDeleteSandboxResponse,
				skipRetry: true,
			});
		} catch (error) {
			// Ignore 404 errors - sandbox already deleted
			if (error instanceof HttpError && error.status === 404) {
				return;
			}
			throw error;
		}
	}

	/** Get all sandboxes in the workspace for a specific project */
	async getSandboxes<const Data extends GetSandboxesData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, GetSandboxesResponse>({
			method: "GET",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes",
			pathSchema: zGetSandboxesPath,
			querySchema: zGetSandboxesQuery,
			responseSchema: zGetSandboxesResponse,
		});
	}

	/** Start a sandbox */
	async startSandbox<const Data extends StartSandboxData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, StartSandboxResponse>({
			method: "POST",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/start",
			pathSchema: zStartSandboxPath,
			responseSchema: zStartSandboxResponse.transform(
				startSandboxResponseTransformer,
			),
		});
	}

	/** Stop a sandbox */
	async stopSandbox<const Data extends StopSandboxData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, StopSandboxResponse>({
			method: "POST",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/stop",
			pathSchema: zStopSandboxPath,
			responseSchema: zStopSandboxResponse.transform(
				stopSandboxResponseTransformer,
			),
		});
	}

	/** Restart a sandbox */
	async restartSandbox<const Data extends RestartSandboxData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, RestartSandboxResponse>({
			method: "POST",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/restart",
			idempotent: false,
			pathSchema: zRestartSandboxPath,
			responseSchema: zRestartSandboxResponse.transform(
				restartSandboxResponseTransformer,
			),
		});
	}

	/** Start a sandbox app */
	async startSandboxApp<const Data extends StartSandboxAppData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, StartSandboxAppResponse>({
			method: "POST",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/apps/{app_id}/start",
			pathSchema: zStartSandboxAppPath,
			responseSchema: zStartSandboxAppResponse.transform(
				startSandboxAppResponseTransformer,
			),
		});
	}

	/** Stop a sandbox app */
	async stopSandboxApp<const Data extends StopSandboxAppData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, StopSandboxAppResponse>({
			method: "POST",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/apps/{app_id}/stop",
			pathSchema: zStopSandboxAppPath,
			responseSchema: zStopSandboxAppResponse.transform(
				stopSandboxAppResponseTransformer,
			),
		});
	}

	/** Get logs for a specific sandbox app */
	async getSandboxAppLogs<const Data extends GetSandboxAppLogsByIdData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, GetSandboxAppLogsByIdResponse>({
			method: "GET",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/apps/{app_id}/logs",
			pathSchema: zGetSandboxAppLogsByIdPath,
			querySchema: zGetSandboxAppLogsByIdQuery,
			responseSchema: zGetSandboxAppLogsByIdResponse,
		});
	}

	/** Get sandbox content (list files/directories at a path) */
	async getSandboxContent<const Data extends GetSandboxContentData>(
		data: ClientData<Data>,
	): Promise<GetSandboxContentResponse> {
		return this.#requestWithValidation<Data, GetSandboxContentResponse>({
			method: "GET",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/content/{path}",
			pathSchema: zGetSandboxContentPath,
			responseSchema: zGetSandboxContentResponse.transform(
				getSandboxContentResponseTransformer,
			),
		});
	}

	/** Delete a file or directory from a sandbox */
	async deleteSandboxFile<const Data extends DeleteSandboxFileData>(
		data: ClientData<Data>,
	): Promise<DeleteSandboxFileResponse> {
		return this.#requestWithValidation<Data, DeleteSandboxFileResponse>({
			method: "DELETE",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/content/{path}",
			pathSchema: zDeleteSandboxFilePath,
			responseSchema: zDeleteSandboxFileResponse,
		});
	}

	/** Create a directory in a sandbox */
	async createSandboxDirectory<const Data extends CreateSandboxDirectoryData>(
		data: ClientData<Data>,
	): Promise<CreateSandboxDirectoryResponse> {
		return this.#requestWithValidation<Data, CreateSandboxDirectoryResponse>({
			method: "POST",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/content/{path}",
			pathSchema: zCreateSandboxDirectoryPath,
			responseSchema: zCreateSandboxDirectoryResponse.transform(
				createSandboxDirectoryResponseTransformer,
			),
		});
	}

	/** Upload a file to a sandbox */
	async uploadSandboxFile(data: {
		body: Blob | File;
		path: { sandbox_id: string; path: string };
	}): Promise<UploadSandboxFileResponse> {
		const pathResult = await zUploadSandboxFilePath.safeParseAsync({
			workspace_domain: this.workspace,
			...data.path,
		});
		if (!pathResult.success) {
			throw pathResult.error;
		}

		const parameterizedUrl = this.#buildUrl<UploadSandboxFileData>({
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/content/upload/{path}",
			path: pathResult.data,
		});

		const url = new URL(parameterizedUrl, this.#apiUrl);
		url.searchParams.set("project_name", this.project_name);

		const filename = data.path.path.split("/").pop() ?? "file";

		const formData = new FormData();
		formData.append("file", data.body, filename);

		const headers = {
			Authorization: `Bearer ${this.#token}`,
			// Note: Don't set Content-Type - fetch will set it with boundary for multipart
		};

		if (this.debugMode) {
			logger.debug("[HTTP REQUEST - Upload]", {
				method: "POST",
				url: url.toString(),
				headers: {
					...headers,
					Authorization: "***",
				},
				formData,
			});
		}

		const response = await this.transport(url.toString(), {
			method: "POST",
			headers,
			body: formData,
		});

		if (!response.ok) {
			throw new HttpError(
				`Failed to upload file: ${response.statusText}`,
				response.status,
			);
		}

		const responseData = await response.json();
		const result = await zUploadSandboxFileResponse
			.transform(uploadSandboxFileResponseTransformer)
			.safeParseAsync(responseData);
		if (!result.success) {
			const prettyError = prettifyError(result.error);
			throw new HttpError(
				`Response validation failed:\n${prettyError}`,
				response.status,
			);
		}

		return result.data;
	}

	/** Download content from a sandbox (file or directory as tar.gz) */
	async downloadSandboxContent(data: {
		path: { sandbox_id: string; path: string };
	}): Promise<{ data: ArrayBuffer; filename: string }> {
		const pathResult = await zDownloadSandboxContentPath.safeParseAsync({
			workspace_domain: this.workspace,
			...data.path,
		});
		if (!pathResult.success) {
			throw pathResult.error;
		}

		const parameterizedUrl = this.#buildUrl<DownloadSandboxContentData>({
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/download/{path}",
			path: pathResult.data,
		});

		const url = new URL(parameterizedUrl, this.#apiUrl);

		const headers = {
			Accept: "application/octet-stream",
			Authorization: `Bearer ${this.#token}`,
		};

		if (this.debugMode) {
			logger.debug("[HTTP REQUEST - Download]", {
				method: "GET",
				url: url.toString(),
				headers: {
					...headers,
					Authorization: "***",
				},
			});
		}

		const response = await this.transport(url.toString(), {
			method: "GET",
			headers,
		});

		if (!response.ok) {
			throw new HttpError(
				`Failed to download content: ${response.statusText}`,
				response.status,
			);
		}

		const contentDisposition = response.headers.get("Content-Disposition");
		let filename = "download";
		if (contentDisposition) {
			const match = contentDisposition.match(/filename="?([^";\n]+)"?/);
			if (match?.[1]) {
				filename = match[1];
			}
		}

		const arrayBuffer = await response.arrayBuffer();
		return { data: arrayBuffer, filename };
	}

	/** Create a new Buddy API client instance */
	constructor(config: BuddyApiConfig) {
		const token = config.token ?? environment.BUDDY_TOKEN;

		if (!token) {
			throw new Error(
				"Buddy API token is required. Set BUDDY_TOKEN environment variable or pass token in config.",
			);
		}

		super({
			...config,
			baseURL: config.apiUrl,
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				...config.headers,
			},
		});

		this.workspace = config.workspace;
		this.project_name = config.project_name;
		this.#apiUrl = config.apiUrl;
		this.#token = token;
		this.setAuthToken(token);
	}
}
