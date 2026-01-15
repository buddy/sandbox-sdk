import { BuddyApiClient } from "@/core/buddy-api-client";
import environment from "@/utils/environment";
import {
	API_URLS,
	getApiUrlFromRegion,
	parseRegion,
	type Region,
} from "@/utils/regions";

/** Connection configuration for workspace and API authentication */
export interface ConnectionConfig {
	/** Workspace name/slug (falls back to BUDDY_WORKSPACE env var) */
	workspace?: string;
	/** Project name/slug (falls back to BUDDY_PROJECT env var) */
	project?: string;
	/** API authentication token (falls back to BUDDY_TOKEN env var) */
	token?: string;
	/** API region: US, EU, or AP (falls back to BUDDY_REGION env var) */
	region?: Region;
	/** Custom API URL for testing (falls back to BUDDY_API_URL env var) */
	apiUrl?: string;
}

/** Resolve connection config with environment variable fallbacks */
function getConfig(connection?: ConnectionConfig) {
	const workspace = connection?.workspace ?? environment.BUDDY_WORKSPACE;

	if (!workspace) {
		throw new Error(
			"Workspace not found. Set workspace in config.connection or BUDDY_WORKSPACE env var.",
		);
	}

	const project = connection?.project ?? environment.BUDDY_PROJECT;

	if (!project) {
		throw new Error(
			"Project not found. Set project in config.connection or BUDDY_PROJECT env var.",
		);
	}

	let apiUrl: string;

	if (connection?.apiUrl) {
		apiUrl = connection.apiUrl;
	} else if (environment.BUDDY_API_URL) {
		apiUrl = environment.BUDDY_API_URL;
	} else if (connection?.region) {
		const region = parseRegion(connection.region);
		apiUrl = getApiUrlFromRegion(region);
	} else if (environment.BUDDY_REGION) {
		const region = parseRegion(environment.BUDDY_REGION);
		apiUrl = getApiUrlFromRegion(region);
	} else {
		apiUrl = API_URLS.US;
	}

	return {
		workspace,
		projectName: project,
		token: connection?.token,
		apiUrl,
	};
}

/** Create a BuddyApiClient from connection config */
export function createClient(connection?: ConnectionConfig): BuddyApiClient {
	const { workspace, projectName, token, apiUrl } = getConfig(connection);

	return new BuddyApiClient({
		workspace,
		project_name: projectName,
		apiUrl,
		...(token ? { token } : {}),
	});
}
