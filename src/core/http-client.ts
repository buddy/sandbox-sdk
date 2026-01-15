import { inspect } from "node:util";
import pRetry, { type Options as RetryOptions } from "p-retry";
import logger from "@/utils/logger";

/** Configuration options for creating an HttpClient instance */
export interface HttpClientConfig {
	/** Base URL prepended to all request paths */
	baseURL?: string;
	/** Request timeout in milliseconds */
	timeout?: number;
	/** Default headers sent with every request */
	headers?: Record<string, string>;
	/** Enable detailed request/response logging */
	debugMode?: boolean;
}

/** Per-request configuration options */
export interface RequestConfig {
	/** Disable automatic retry on transient failures */
	skipRetry?: boolean;
	/** URL query parameters to append */
	queryParams?: Record<string, string | number | boolean | undefined>;
	/** Additional headers for this request only */
	headers?: Record<string, string>;
	/** Response parsing mode */
	responseType?: "json" | "text";
}

/** Normalized HTTP response with status, data, and headers */
export interface HttpResponse<T = unknown> {
	/** HTTP status code (e.g. 200, 404) */
	status: number;
	/** HTTP status text (e.g. "OK", "Not Found") */
	statusText: string;
	/** Parsed response body */
	data: T;
	/** Response headers */
	headers: Headers;
}

/** Custom error class for HTTP request failures with status and response details */
export class HttpError extends Error {
	public readonly status: number;
	public readonly response: HttpResponse | undefined;
	public readonly errors: unknown[] | undefined;

	/** Create an HttpError with message, status code, and optional response */
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

	/** Custom inspect output for Node.js util.inspect */
	[inspect.custom](): string {
		return this.stack ?? `${this.name}: ${this.message}`;
	}
}

/** Base HTTP client with retry logic, timeout handling, and authentication support */
export class HttpClient {
	readonly #baseURL: string;
	readonly #timeout: number;
	readonly #defaultHeaders: Record<string, string>;
	protected readonly debugMode: boolean;
	#authToken?: string;

	/** Create a new HTTP client with optional base URL, timeout, and headers */
	constructor(config: HttpClientConfig = {}) {
		// Enable HTTP debugging when logger level is debug
		this.debugMode = config.debugMode ?? logger.level >= 5;
		this.#baseURL = config.baseURL ?? "";
		this.#timeout = config.timeout ?? 30_000;
		this.#defaultHeaders = {
			"Content-Type": "application/json",
			...config.headers,
		};
	}

	/** Build a full URL from path and optional query parameters */
	#buildUrl(
		path: string,
		queryParameters?: Record<string, string | number | boolean | undefined>,
	): string {
		const url = new URL(path, this.#baseURL);

		if (queryParameters) {
			for (const [key, value] of Object.entries(queryParameters)) {
				if (value !== undefined) {
					url.searchParams.set(key, String(value));
				}
			}
		}

		return url.toString();
	}

	/** Merge default headers with additional headers and auth token */
	#getHeaders(
		additionalHeaders?: Record<string, string>,
	): Record<string, string> {
		const headers: Record<string, string> = {
			...this.#defaultHeaders,
			...additionalHeaders,
		};

		if (this.#authToken) {
			headers["Authorization"] = `Bearer ${this.#authToken}`;
		}

		return headers;
	}

	/** Execute a request function with automatic retry on transient failures */
	async #executeWithRetry<T>(
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

	/** Execute an HTTP request with timeout, retry, and error handling */
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
		const fullUrl = this.#buildUrl(url, queryParams);
		const headers = this.#getHeaders(additionalHeaders);

		const makeRequest = async (): Promise<HttpResponse<T>> => {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => {
				controller.abort();
			}, this.#timeout);

			try {
				if (this.debugMode) {
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

				if (this.debugMode) {
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

		return this.#executeWithRetry(makeRequest, skipRetry);
	}

	/** Perform a GET request */
	async get<T = unknown>(
		url: string,
		config?: RequestConfig,
	): Promise<HttpResponse<T>> {
		return this.#request<T>("GET", url, undefined, config);
	}

	/** Perform a POST request with optional body data */
	async post<T = unknown>(
		url: string,
		data?: unknown,
		config?: RequestConfig,
	): Promise<HttpResponse<T>> {
		return this.#request<T>("POST", url, data ?? {}, config);
	}

	/** Perform a DELETE request */
	async delete<T = unknown>(
		url: string,
		config?: RequestConfig,
	): Promise<HttpResponse<T>> {
		return this.#request<T>("DELETE", url, undefined, config);
	}

	/** Set the Bearer token for authenticated requests */
	setAuthToken(token: string): void {
		this.#authToken = token;
	}
}
