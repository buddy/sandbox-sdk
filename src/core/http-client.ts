import { inspect } from "node:util";
import pRetry, { type Options as RetryOptions } from "p-retry";
import environment from "@/utils/environment";
import logger from "@/utils/logger";

export interface HttpClientConfig {
	baseURL?: string;
	timeout?: number;
	headers?: Record<string, string>;
	debugMode?: boolean;
}

export interface RequestConfig {
	skipRetry?: boolean;
	queryParams?: Record<string, string | number | boolean | undefined>;
	headers?: Record<string, string>;
	responseType?: "json" | "text";
}

export interface HttpResponse<T = unknown> {
	status: number;
	statusText: string;
	data: T;
	headers: Headers;
}

export class HttpError extends Error {
	public readonly status: number;
	public readonly response: HttpResponse | undefined;
	public readonly errors: unknown[] | undefined;

	constructor(message: string, status: number, response?: HttpResponse) {
		const apiErrors =
			response?.data &&
			typeof response.data === "object" &&
			"errors" in response.data
				? (response.data as { errors: unknown[] }).errors
				: undefined;

		let fullMessage = message;
		if (status) {
			fullMessage = `HTTP ${String(status)}: ${message}`;
		}
		if (apiErrors && Array.isArray(apiErrors) && apiErrors.length > 0) {
			const errorMessages = apiErrors
				.map((error) =>
					typeof error === "object" && error && "message" in error
						? (error as { message: string }).message
						: String(error),
				)
				.filter(Boolean);
			if (errorMessages.length > 0) {
				fullMessage += `\n${errorMessages.join("\n")}`;
			}
		}

		super(fullMessage);
		this.name = "HttpError";
		this.status = status;

		Object.defineProperty(this, "response", {
			value: response,
			enumerable: false,
			writable: false,
			configurable: true,
		});
		Object.defineProperty(this, "errors", {
			value: apiErrors,
			enumerable: false,
			writable: false,
			configurable: true,
		});

		Object.setPrototypeOf(this, HttpError.prototype);
	}

	[inspect.custom](): string {
		return this.stack ?? `${this.name}: ${this.message}`;
	}
}

export class HttpClient {
	private readonly baseURL: string;
	private readonly timeout: number;
	private readonly defaultHeaders: Record<string, string>;
	protected readonly debugMode: boolean;
	private authToken?: string;

	constructor(config: HttpClientConfig = {}) {
		this.debugMode = config.debugMode ?? false;
		this.baseURL = config.baseURL ?? "";
		this.timeout = config.timeout ?? 30_000;
		this.defaultHeaders = {
			"Content-Type": "application/json",
			...config.headers,
		};
	}

	private buildUrl(
		path: string,
		queryParameters?: Record<string, string | number | boolean | undefined>,
	): string {
		const url = new URL(path, this.baseURL);

		if (queryParameters) {
			for (const [key, value] of Object.entries(queryParameters)) {
				if (value !== undefined) {
					url.searchParams.set(key, String(value));
				}
			}
		}

		return url.toString();
	}

	private getHeaders(
		additionalHeaders?: Record<string, string>,
	): Record<string, string> {
		const headers: Record<string, string> = {
			...this.defaultHeaders,
			...additionalHeaders,
		};

		if (this.authToken) {
			headers["Authorization"] = `Bearer ${this.authToken}`;
		}

		return headers;
	}

	private async executeWithRetry<T>(
		requestFunction: () => Promise<HttpResponse<T>>,
		skipRetry = false,
	): Promise<HttpResponse<T>> {
		if (skipRetry) {
			return requestFunction();
		}

		const retryOptions: RetryOptions = {
			retries: 3,
			minTimeout: 1000,
			maxTimeout: 10_000,
			onFailedAttempt: ({ error }) => {
				if (error instanceof HttpError) {
					const status = error.status;
					if (status && status >= 400 && status < 500 && status !== 429) {
						throw error;
					}
				}
			},
		};

		return pRetry(requestFunction, retryOptions);
	}

	async #request<T = unknown>(
		method: string,
		url: string,
		data?: unknown,
		config?: RequestConfig,
	): Promise<HttpResponse<T>> {
		const {
			skipRetry,
			queryParams,
			headers: additionalHeaders,
			responseType = "json",
		} = config ?? {};
		const fullUrl = this.buildUrl(url, queryParams);
		const headers = this.getHeaders(additionalHeaders);

		const makeRequest = async (): Promise<HttpResponse<T>> => {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => {
				controller.abort();
			}, this.timeout);

			try {
				if (this.debugMode && environment.DEBUG_HTTP) {
					logger.debug("[HTTP REQUEST]", {
						method,
						url: fullUrl,
						headers: {
							...headers,
							Authorization: headers["Authorization"] ? "***" : undefined,
						},
						body: data,
					});
				}

				const fetchOptions: RequestInit = {
					method,
					headers,
					signal: controller.signal,
				};

				if (data !== undefined) {
					fetchOptions.body = JSON.stringify(data);
				}

				const response = await fetch(fullUrl, fetchOptions);

				let responseData: T;
				if (responseType === "text") {
					responseData = (await response.text()) as T;
				} else {
					const text = await response.text();
					responseData = text ? (JSON.parse(text) as T) : (undefined as T);
				}

				const httpResponse: HttpResponse<T> = {
					status: response.status,
					statusText: response.statusText,
					data: responseData,
					headers: response.headers,
				};

				if (this.debugMode && environment.DEBUG_HTTP) {
					logger.debug("[HTTP RESPONSE]", {
						status: response.status,
						body: responseData,
					});
				}

				clearTimeout(timeoutId);

				if (!response.ok) {
					throw new HttpError(
						response.statusText || "Request failed",
						response.status,
						httpResponse as HttpResponse,
					);
				}

				return httpResponse;
			} catch (error) {
				clearTimeout(timeoutId);
				if (error instanceof HttpError) {
					throw error;
				}
				if (error instanceof Error && error.name === "AbortError") {
					throw new HttpError("Request timeout", 0);
				}
				throw new HttpError(
					error instanceof Error ? error.message : "Request failed",
					0,
				);
			}
		};

		return this.executeWithRetry(makeRequest, skipRetry);
	}

	async get<T = unknown>(
		url: string,
		config?: RequestConfig,
	): Promise<HttpResponse<T>> {
		return this.#request<T>("GET", url, undefined, config);
	}

	async post<T = unknown>(
		url: string,
		data?: unknown,
		config?: RequestConfig,
	): Promise<HttpResponse<T>> {
		return this.#request<T>("POST", url, data ?? {}, config);
	}

	async delete<T = unknown>(
		url: string,
		config?: RequestConfig,
	): Promise<HttpResponse<T>> {
		return this.#request<T>("DELETE", url, undefined, config);
	}

	setAuthToken(token: string): void {
		this.authToken = token;
	}
}
