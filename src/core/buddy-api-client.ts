import { prettifyError, type z } from "zod";
import {
	addSandboxResponseTransformer,
	addSandboxSnapshotResponseTransformer,
	createSandboxDirectoryResponseTransformer,
	executeSandboxCommandResponseTransformer,
	getProjectSnapshotsResponseTransformer,
	getSandboxCommandResponseTransformer,
	getSandboxContentResponseTransformer,
	getSandboxResponseTransformer,
	getSandboxSnapshotResponseTransformer,
	getSandboxSnapshotsResponseTransformer,
	restartSandboxResponseTransformer,
	startSandboxAppResponseTransformer,
	startSandboxResponseTransformer,
	stopSandboxAppResponseTransformer,
	stopSandboxResponseTransformer,
	terminateSandboxCommandResponseTransformer,
	updateSandboxResponseTransformer,
	uploadSandboxFileResponseTransformer,
} from "@/api/openapi/transformers.gen";
import type {
	AddSandboxData,
	AddSandboxResponse,
	AddSandboxSnapshotData,
	AddSandboxSnapshotResponse,
	CreateSandboxDirectoryData,
	CreateSandboxDirectoryResponse,
	DeleteSandboxData,
	DeleteSandboxFileData,
	DeleteSandboxFileResponse,
	DeleteSandboxResponse,
	DeleteSandboxSnapshotData,
	DeleteSandboxSnapshotResponse,
	DownloadSandboxContentData,
	ExecuteSandboxCommandData,
	ExecuteSandboxCommandResponse,
	GetIdentifiersData,
	GetIdentifiersResponse,
	GetProjectSnapshotsData,
	GetProjectSnapshotsResponse,
	GetSandboxAppLogsByIdData,
	GetSandboxAppLogsByIdResponse,
	GetSandboxCommandData,
	GetSandboxCommandLogsData,
	GetSandboxCommandResponse,
	GetSandboxContentData,
	GetSandboxContentResponse,
	GetSandboxData,
	GetSandboxesData,
	GetSandboxesResponse,
	GetSandboxResponse,
	GetSandboxSnapshotData,
	GetSandboxSnapshotResponse,
	GetSandboxSnapshotsData,
	GetSandboxSnapshotsResponse,
	RestartSandboxData,
	RestartSandboxResponse,
	SandboxCommandLog,
	StartSandboxAppData,
	StartSandboxAppResponse,
	StartSandboxData,
	StartSandboxResponse,
	StopSandboxAppData,
	StopSandboxAppResponse,
	StopSandboxData,
	StopSandboxResponse,
	TerminateSandboxCommandData,
	TerminateSandboxCommandResponse,
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
	zCreateSandboxDirectoryPath,
	zCreateSandboxDirectoryResponse,
	zDeleteSandboxFilePath,
	zDeleteSandboxFileResponse,
	zDeleteSandboxPath,
	zDeleteSandboxResponse,
	zDeleteSandboxSnapshotPath,
	zDeleteSandboxSnapshotResponse,
	zDownloadSandboxContentPath,
	zExecuteSandboxCommandBody,
	zExecuteSandboxCommandPath,
	zExecuteSandboxCommandResponse,
	zGetIdentifiersPath,
	zGetIdentifiersQuery,
	zGetIdentifiersResponse,
	zGetProjectSnapshotsPath,
	zGetProjectSnapshotsQuery,
	zGetProjectSnapshotsResponse,
	zGetSandboxAppLogsByIdPath,
	zGetSandboxAppLogsByIdQuery,
	zGetSandboxAppLogsByIdResponse,
	zGetSandboxCommandLogsPath,
	zGetSandboxCommandLogsQuery,
	zGetSandboxCommandPath,
	zGetSandboxCommandResponse,
	zGetSandboxContentPath,
	zGetSandboxContentResponse,
	zGetSandboxesPath,
	zGetSandboxesQuery,
	zGetSandboxesResponse,
	zGetSandboxPath,
	zGetSandboxResponse,
	zGetSandboxSnapshotPath,
	zGetSandboxSnapshotResponse,
	zGetSandboxSnapshotsPath,
	zGetSandboxSnapshotsResponse,
	zRestartSandboxPath,
	zRestartSandboxResponse,
	zSandboxCommandLog,
	zStartSandboxAppPath,
	zStartSandboxAppResponse,
	zStartSandboxPath,
	zStartSandboxResponse,
	zStopSandboxAppPath,
	zStopSandboxAppResponse,
	zStopSandboxPath,
	zStopSandboxResponse,
	zTerminateSandboxCommandPath,
	zTerminateSandboxCommandResponse,
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
import type { ClientData, Data, DataUrl } from "@/types";
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
	}: {
		method: "GET" | "POST" | "DELETE" | "PATCH";
		url: DataUrl<D>;
		data: ClientData<D>;
		bodySchema?: z.ZodType;
		pathSchema: z.ZodType;
		querySchema?: z.ZodType;
		responseSchema: z.ZodType<Response>;
		skipRetry?: boolean;
	}): Promise<Response> {
		const pathResult = await pathSchema.safeParseAsync({
			workspace_domain: this.workspace,
			...(data.path ?? {}),
		});
		if (!pathResult.success) {
			throw pathResult.error;
		}
		const validatedPath = pathResult.data as Record<string, string>;

		let validatedQuery: Record<string, string | number | boolean> | undefined;
		if (querySchema) {
			const queryResult = await querySchema.safeParseAsync({
				project_name: this.project_name,
				...(data.query ?? {}),
			});
			if (!queryResult.success) {
				throw queryResult.error;
			}
			validatedQuery = queryResult.data as Record<
				string,
				string | number | boolean
			>;
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

	/** Execute a command in a sandbox */
	async executeCommand<const Data extends ExecuteSandboxCommandData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, ExecuteSandboxCommandResponse>({
			method: "POST",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/commands",
			bodySchema: zExecuteSandboxCommandBody,
			pathSchema: zExecuteSandboxCommandPath,
			responseSchema: zExecuteSandboxCommandResponse.transform(
				executeSandboxCommandResponseTransformer,
			),
		});
	}

	/** Get a specific command execution details */
	async getCommandDetails<const Data extends GetSandboxCommandData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, GetSandboxCommandResponse>({
			method: "GET",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/commands/{id}",
			pathSchema: zGetSandboxCommandPath,
			responseSchema: zGetSandboxCommandResponse.transform(
				getSandboxCommandResponseTransformer,
			),
		});
	}

	/** Terminate a running command in a sandbox */
	async terminateCommand<const Data extends TerminateSandboxCommandData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, TerminateSandboxCommandResponse>({
			method: "POST",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/commands/{command_id}/terminate",
			pathSchema: zTerminateSandboxCommandPath,
			responseSchema: zTerminateSandboxCommandResponse.transform(
				terminateSandboxCommandResponseTransformer,
			),
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

		const response = await fetch(url.toString(), {
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

		const response = await fetch(url.toString(), {
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

	/** Stream logs from a specific command execution */
	async *streamCommandLogs<const Data extends GetSandboxCommandLogsData>(
		data: ClientData<Data>,
	): AsyncGenerator<SandboxCommandLog, void, unknown> {
		const pathResult = await zGetSandboxCommandLogsPath.safeParseAsync({
			workspace_domain: this.workspace,
			...(data.path ?? {}),
		});
		if (!pathResult.success) {
			throw pathResult.error;
		}

		const queryResult = await zGetSandboxCommandLogsQuery.safeParseAsync(
			data.query ?? {},
		);
		if (!queryResult.success) {
			throw queryResult.error;
		}

		const parameterizedUrl = this.#buildUrl<Data>({
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/commands/{command_id}/logs",
			path: pathResult.data as Record<string, string>,
		});

		const url = new URL(parameterizedUrl, this.#apiUrl);
		if (queryResult.data.follow !== undefined) {
			url.searchParams.set("follow", String(queryResult.data.follow));
		}

		const headers = {
			Accept: "application/jsonl",
			"Content-Type": "application/json",
			Authorization: `Bearer ${this.#token}`,
		};

		const response = await fetch(url.toString(), {
			method: "GET",
			headers,
		});

		if (this.debugMode) {
			logger.debug("[HTTP REQUEST - Streaming]", {
				method: "GET",
				url: url.toString(),
				headers: {
					...headers,
					Authorization: "***",
				},
			});
		}

		if (!response.ok) {
			throw new HttpError(
				`Failed to stream logs: ${response.statusText}`,
				response.status,
			);
		}

		const contentType = response.headers.get("content-type");
		if (!contentType?.includes("application/jsonl")) {
			throw new Error(
				`Expected application/jsonl content type, got: ${contentType ?? "none"}`,
			);
		}

		if (!response.body) {
			throw new Error("No response body available for streaming");
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				const readResult = await reader.read();
				if (readResult.done) break;

				const chunk = readResult.value as Uint8Array;
				buffer += decoder.decode(chunk, { stream: true });

				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					if (!line.trim()) continue;

					const logEntry = await this.#parseAndValidateLogEntry(line);

					if (this.debugMode) {
						logger.debug(`[STREAM] ${logEntry.type}`, {
							content: logEntry.data,
						});
					}

					yield logEntry;
				}
			}

			// Process any remaining data in buffer
			if (buffer.trim()) {
				yield this.#parseAndValidateLogEntry(buffer);
			}
		} finally {
			reader.releaseLock();
		}
	}

	/** Parse a JSON line and validate it as a SandboxCommandLog */
	async #parseAndValidateLogEntry(line: string): Promise<SandboxCommandLog> {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (error) {
			throw new Error(
				`Failed to parse log entry as JSON: ${error instanceof Error ? error.message : String(error)}. Line: ${line}`,
			);
		}

		const result = await zSandboxCommandLog.safeParseAsync(parsed);
		if (!result.success) {
			throw result.error;
		}

		return result.data;
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
