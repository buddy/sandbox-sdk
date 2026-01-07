interface StringConfig {
	type: "string";
	required?: boolean;
	secret?: boolean;
}
interface BooleanConfig {
	type: "boolean";
	defaultValue?: boolean;
	secret?: boolean;
}
type EnvironmentConfigSchema = Readonly<
	Record<string, StringConfig | BooleanConfig>
>;

const environmentConfig = {
	BUDDY_TOKEN: { type: "string", secret: true },
	BUDDY_API_URL: { type: "string" },
	BUDDY_WORKSPACE: { type: "string" },
	BUDDY_PROJECT_NAME: { type: "string" },
	BUDDY_LOGGER_LEVEL: { type: "string" },
	DEBUG_HTTP: { type: "boolean", defaultValue: false },
} as const satisfies EnvironmentConfigSchema;

type EnvironmentConfig = {
	[K in keyof typeof environmentConfig]: (typeof environmentConfig)[K]["type"] extends "boolean"
		? boolean
		: (typeof environmentConfig)[K] extends { required: true }
			? string
			: string | undefined;
};

function processConfigEntry<K extends keyof typeof environmentConfig>(
	key: K,
	config: (typeof environmentConfig)[K],
): EnvironmentConfig[K] {
	if (config.type === "boolean") {
		return getEnvironmentFlag(
			key as string,
			(config as BooleanConfig).defaultValue ?? false,
		) as EnvironmentConfig[K];
	} else {
		const stringConfig = config as StringConfig;
		return stringConfig.required === true
			? (getEnvironment(key as string, true) as EnvironmentConfig[K])
			: (getEnvironment(key as string, false) as EnvironmentConfig[K]);
	}
}

interface EnvironmentResult {
	error?: unknown;
	variables: EnvironmentConfig;
}

function loadEnvironment(): EnvironmentResult {
	const variables = {} as EnvironmentConfig;

	// validate required variables at load time for early error detection
	for (const key of Object.keys(
		environmentConfig,
	) as (keyof typeof environmentConfig)[]) {
		try {
			const config = environmentConfig[key];
			if (config.type === "string" && (config as StringConfig).required) {
				getEnvironment(key as string, true);
			}
		} catch (error: unknown) {
			return {
				error,
				variables: {} as EnvironmentConfig,
			};
		}
	}

	// define getters for all variables to read fresh from process.env
	for (const key of Object.keys(
		environmentConfig,
	) as (keyof typeof environmentConfig)[]) {
		Object.defineProperty(variables, key, {
			get() {
				return processConfigEntry(key, environmentConfig[key]);
			},
			enumerable: true,
			configurable: true,
		});
	}

	return {
		variables,
	};
}

function getEnvironment(key: string, required: true): string;
function getEnvironment(key: string, required?: false): string | undefined;
function getEnvironment(key: string, required = false): string | undefined {
	const MISSING_REQUIRED_ENVIRONMENT_VARIABLE_ERROR = `Missing required configuration. Please set the ${key} environment variable.`;

	const value = process.env[key];

	if (value === undefined) {
		if (required) {
			throw new Error(MISSING_REQUIRED_ENVIRONMENT_VARIABLE_ERROR);
		}
		return undefined;
	}

	// Trim whitespace from string values
	const trimmedValue = value.trim();

	// Treat empty strings as undefined after trimming
	if (trimmedValue === "") {
		if (required) {
			throw new Error(MISSING_REQUIRED_ENVIRONMENT_VARIABLE_ERROR);
		}
		return undefined;
	}

	return trimmedValue;
}

function getEnvironmentFlag(key: string, defaultValue = false): boolean {
	const value = process.env[key];

	if (value === undefined) {
		return defaultValue;
	}

	const falseValues = ["0", "false", "no", "off", ""];
	return !falseValues.includes(value.toLowerCase().trim());
}

const environmentResult = loadEnvironment();
export default environmentResult.variables;
