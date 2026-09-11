import { HttpResponse, http } from "msw";
import { type SetupServerApi, setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";
import {
	BuddyApiClient,
	type BuddyApiConfig,
} from "~/src/core/buddy-api-client";

export const TEST_API_URL = "https://api.test.buddy.works";
export const TEST_WORKSPACE = "test-workspace";
export const TEST_PROJECT = "test-project";
export const TEST_TOKEN = "test-token";

export const TEST_CONNECTION = {
	workspace: TEST_WORKSPACE,
	token: TEST_TOKEN,
	apiUrl: TEST_API_URL,
};

export const SANDBOXES_URL = `${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/sandboxes`;
export const SNAPSHOTS_URL = `${SANDBOXES_URL}/snapshots`;
export const IDENTIFIERS_URL = `${TEST_API_URL}/workspaces/${TEST_WORKSPACE}/identifiers`;

/** An msw server wired into the suite's lifecycle, rejecting unhandled requests */
export function useMockApi(): SetupServerApi {
	const server = setupServer();

	beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
	afterEach(() => server.resetHandlers());
	afterAll(() => server.close());

	return server;
}

export const buildClient = (
	scope: Pick<
		BuddyApiConfig,
		"project_name" | "environment" | "environment_id"
	> = {},
) => new BuddyApiClient({ ...TEST_CONNECTION, ...scope });

/** Capture the query params of every GET to `url`, answering with `response` */
export function recordQueries(
	server: SetupServerApi,
	url: string,
	response: Record<string, unknown>,
) {
	const queries: URLSearchParams[] = [];

	server.use(
		http.get(url, ({ request }) => {
			queries.push(new URL(request.url).searchParams);
			return HttpResponse.json(response);
		}),
	);

	return queries;
}

/** Capture the JSON body of the next POST to `url`, answering 201 with `response` */
export function captureBody(
	server: SetupServerApi,
	url: string,
	response: Record<string, unknown>,
) {
	const captured: { body?: Record<string, unknown> } = {};

	server.use(
		http.post(url, async ({ request }) => {
			captured.body = (await request.json()) as Record<string, unknown>;
			return HttpResponse.json(response, { status: 201 });
		}),
	);

	return captured;
}
