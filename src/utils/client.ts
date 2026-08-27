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
	/**
	 * Project name/slug (falls back to BUDDY_PROJECT env var). Combined with
	 * `environment` it only says where to look that identifier up.
	 */
	project?: string;
	/** Environment identifier (falls back to BUDDY_ENVIRONMENT env var) */
	environment?: string;
	/** Environment ID - same as `environment`, but skips the identifier lookup */
	environmentId?: string;
	/** API authentication token (falls back to BUDDY_TOKEN env var) */
	token?: string;
	/** API region: US, EU, or AS (falls back to BUDDY_REGION env var) */
	region?: Region;
	/** Custom API URL for testing (falls back to BUDDY_API_URL env var) */
	apiUrl?: string;
}

type ScopeSource = Pick<
	ConnectionConfig,
	"project" | "environment" | "environmentId"
>;

/**
 * Resolve which project/environment the client works against.
 *
 * A `connection` mentioning any scope field decides the scope by itself; the
 * env vars only apply when it says nothing. Presence of the key counts, not its
 * value, so `{ project: undefined }` asks for workspace scope.
 *
 * An environment given without a project still borrows BUDDY_PROJECT: by then
 * the scope is settled, and project-scoped environments are invisible to a
 * workspace-level lookup.
 */
function resolveScopeSource(connection?: ConnectionConfig): ScopeSource {
	const declaresScope =
		connection !== undefined &&
		("project" in connection ||
			"environment" in connection ||
			"environmentId" in connection);

	if (declaresScope) {
		return {
			project:
				connection !== undefined && "project" in connection
					? connection.project
					: environment.BUDDY_PROJECT,
			environment: connection?.environment,
			environmentId: connection?.environmentId,
		};
	}

	return {
		project: environment.BUDDY_PROJECT,
		environment: environment.BUDDY_ENVIRONMENT,
	};
}

/** Resolve connection config with environment variable fallbacks */
function getConfig(connection?: ConnectionConfig) {
	const workspace = connection?.workspace ?? environment.BUDDY_WORKSPACE;

	if (!workspace) {
		throw new Error(
			"Workspace not found. Set workspace in config.connection or BUDDY_WORKSPACE env var.",
		);
	}

	const scope = resolveScopeSource(connection);

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
		projectName: scope.project,
		environmentIdentifier: scope.environment,
		environmentId: scope.environmentId,
		token: connection?.token,
		apiUrl,
	};
}

/** Create a BuddyApiClient from connection config */
export function createClient(connection?: ConnectionConfig): BuddyApiClient {
	const {
		workspace,
		projectName,
		environmentIdentifier,
		environmentId,
		token,
		apiUrl,
	} = getConfig(connection);

	return new BuddyApiClient({
		workspace,
		apiUrl,
		...(projectName ? { project_name: projectName } : {}),
		...(environmentIdentifier ? { environment: environmentIdentifier } : {}),
		...(environmentId ? { environment_id: environmentId } : {}),
		...(token ? { token } : {}),
	});
}
