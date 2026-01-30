import { prettifyError, z } from "zod";
import {
	type AddSandboxData,
	type AddSandboxResponse,
	addSandboxResponseTransformer,
	type CreateSandboxDirectoryData,
	type CreateSandboxDirectoryResponse,
	createSandboxDirectoryResponseTransformer,
	type DeleteSandboxData,
	type DeleteSandboxFileData,
	type DeleteSandboxFileResponse,
	type DeleteSandboxResponse,
	type DownloadSandboxContentData,
	type ExecuteSandboxCommandData,
	type ExecuteSandboxCommandResponse,
	type GetIdentifiersData,
	type GetIdentifiersResponse,
	type GetSandboxCommandData,
	type GetSandboxCommandLogsData,
	type GetSandboxCommandResponse,
	type GetSandboxContentData,
	type GetSandboxContentResponse,
	type GetSandboxData,
	type GetSandboxesData,
	type GetSandboxesResponse,
	type GetSandboxResponse,
	getSandboxContentResponseTransformer,
	getSandboxResponseTransformer,
	type RestartSandboxData,
	type RestartSandboxResponse,
	restartSandboxResponseTransformer,
	type SandboxCommandLog,
	type StartSandboxData,
	type StartSandboxResponse,
	type StopSandboxData,
	type StopSandboxResponse,
	startSandboxResponseTransformer,
	stopSandboxResponseTransformer,
	type TerminateSandboxCommandData,
	type TerminateSandboxCommandResponse,
	type UploadSandboxFileData,
	type UploadSandboxFileResponse,
	uploadSandboxFileResponseTransformer,
	zAddSandboxData,
	zAddSandboxResponse,
	zCreateSandboxDirectoryData,
	zCreateSandboxDirectoryResponse,
	zDeleteSandboxData,
	zDeleteSandboxFileData,
	zDeleteSandboxFileResponse,
	zDeleteSandboxResponse,
	zDownloadSandboxContentData,
	zExecuteSandboxCommandData,
	zExecuteSandboxCommandResponse,
	zGetIdentifiersData,
	zGetIdentifiersResponse,
	zGetSandboxCommandData,
	zGetSandboxCommandLogsData,
	zGetSandboxCommandResponse,
	zGetSandboxContentData,
	zGetSandboxContentResponse,
	zGetSandboxData,
	zGetSandboxesData,
	zGetSandboxesResponse,
	zGetSandboxResponse,
	zRestartSandboxData,
	zRestartSandboxResponse,
	zSandboxCommandLog,
	zStartSandboxData,
	zStartSandboxResponse,
	zStopSandboxData,
	zStopSandboxResponse,
	zTerminateSandboxCommandData,
	zTerminateSandboxCommandResponse,
	zUploadSandboxFileData,
	zUploadSandboxFileResponse,
} from "@/api/openapi";
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

	/** Check if a schema expects query parameters (not ZodNever) */
	#schemaExpectsQuery(schema: z.ZodObject<{ query: z.ZodType }>): boolean {
		const querySchema = schema.shape.query;
		if (querySchema instanceof z.ZodOptional) {
			const inner = querySchema._def.innerType;
			if (inner instanceof z.ZodNever) {
				return false;
			}
		}
		return true;
	}

	/** Execute an HTTP request with input/output validation */
	async #requestWithValidation<const D extends Data, Response>({
		method,
		url,
		data,
		dataSchema,
		responseSchema,
		skipRetry,
	}: {
		method: "GET" | "POST" | "DELETE";
		url: DataUrl<D>;
		data: ClientData<D>;
		dataSchema: z.ZodObject<{
			body: z.ZodType;
			path: z.ZodType;
			query: z.ZodType;
		}>;
		responseSchema: z.ZodType<Response>;
		skipRetry?: boolean;
	}): Promise<Response> {
		const expectsQuery = this.#schemaExpectsQuery(
			dataSchema as z.ZodObject<{ query: z.ZodType }>,
		);

		const fullData = {
			body: data.body,
			path: {
				workspace_domain: this.workspace,
				...(data.path ?? {}),
			},
			query: expectsQuery
				? {
						project_name: this.project_name,
						...(data.query ?? {}),
					}
				: undefined,
		};

		const result = await dataSchema.safeParseAsync(fullData);
		if (!result.success) {
			throw result.error;
		}
		const validatedData = result.data;

		const parameterizedUrl = this.#buildUrl<D>({
			url,
			path: validatedData.path as Record<string, string>,
		});

		const requestConfig: RequestConfig = {
			queryParams: validatedData.query as
				| Record<string, string | number | boolean>
				| undefined,
			skipRetry,
		};

		let request: Promise<HttpResponse>;

		switch (method) {
			case "POST": {
				request = this.post(
					parameterizedUrl,
					validatedData.body ?? {},
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
			dataSchema: zAddSandboxData,
			responseSchema: zAddSandboxResponse.transform(
				addSandboxResponseTransformer,
			),
		});
	}

	/** Get a specific sandbox by its ID */
	async getSandboxById<const Data extends GetSandboxData>(
		data: ClientData<Data>,
	) {
		return this.#requestWithValidation<Data, GetSandboxResponse>({
			method: "GET",
			data,
			url: "/workspaces/{workspace_domain}/sandboxes/{id}",
			dataSchema: zGetSandboxData,
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
			dataSchema: zGetIdentifiersData,
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
			dataSchema: zExecuteSandboxCommandData,
			responseSchema: zExecuteSandboxCommandResponse,
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
			dataSchema: zGetSandboxCommandData,
			responseSchema: zGetSandboxCommandResponse,
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
			dataSchema: zTerminateSandboxCommandData,
			responseSchema: zTerminateSandboxCommandResponse,
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
				dataSchema: zDeleteSandboxData,
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
			dataSchema: zGetSandboxesData,
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
			dataSchema: zStartSandboxData,
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
			dataSchema: zStopSandboxData,
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
			dataSchema: zRestartSandboxData,
			responseSchema: zRestartSandboxResponse.transform(
				restartSandboxResponseTransformer,
			),
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
			dataSchema: zGetSandboxContentData,
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
			dataSchema: zDeleteSandboxFileData,
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
			dataSchema: zCreateSandboxDirectoryData,
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
		const fullData = {
			body: data.body,
			path: {
				workspace_domain: this.workspace,
				...(data.path ?? {}),
			},
			query: undefined,
		};

		const validationResult = await zUploadSandboxFileData.safeParseAsync({
			...fullData,
			body: undefined, // Skip body validation for binary data
		});
		if (!validationResult.success) {
			throw validationResult.error;
		}
		const validatedData = validationResult.data;

		const parameterizedUrl = this.#buildUrl<UploadSandboxFileData>({
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/content/upload/{path}",
			path: validatedData.path,
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
		const fullData = {
			body: undefined,
			path: {
				workspace_domain: this.workspace,
				...data.path,
			},
			query: undefined,
		};

		const validationResult =
			await zDownloadSandboxContentData.safeParseAsync(fullData);
		if (!validationResult.success) {
			throw validationResult.error;
		}
		const validatedData = validationResult.data;

		const parameterizedUrl = this.#buildUrl<DownloadSandboxContentData>({
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/download/{path}",
			path: validatedData.path,
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
		const fullData = {
			body: data.body,
			path: {
				workspace_domain: this.workspace,
				...(data.path ?? {}),
			},
			query: data.query,
		};

		const validationResult =
			await zGetSandboxCommandLogsData.safeParseAsync(fullData);
		if (!validationResult.success) {
			throw validationResult.error;
		}
		const validatedData = validationResult.data;

		const parameterizedUrl = this.#buildUrl<Data>({
			url: "/workspaces/{workspace_domain}/sandboxes/{sandbox_id}/commands/{command_id}/logs",
			path: validatedData.path,
		});

		const url = new URL(parameterizedUrl, this.#apiUrl);
		if (validatedData.query?.follow !== undefined) {
			url.searchParams.set("follow", String(validatedData.query.follow));
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
