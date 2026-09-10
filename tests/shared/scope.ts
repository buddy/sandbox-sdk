const workspace = process.env["BUDDY_TEST_WORKSPACE"];
const project = process.env["BUDDY_TEST_PROJECT"];

export const workspaceEnvironment = process.env["BUDDY_TEST_ENVIRONMENT"];
export const projectEnvironment = process.env["BUDDY_TEST_PROJECT_ENVIRONMENT"];

export const workspaceConnection = workspace
	? { workspace, project: undefined }
	: undefined;

/** `project: undefined` keeps the client from borrowing BUDDY_PROJECT */
export const workspaceEnvironmentConnection =
	workspace && workspaceEnvironment
		? { workspace, project: undefined, environment: workspaceEnvironment }
		: undefined;

export const projectEnvironmentConnection =
	workspace && project && projectEnvironment
		? { workspace, project, environment: projectEnvironment }
		: undefined;
