/**
 * The suite runs against a shared workspace, so everything it creates carries
 * one prefix - visible in the UI, and enough for the teardown to sweep by.
 */
export const TEST_NAME_PREFIX = "test-sandbox-";
export const TEST_IDENTIFIER_PREFIX = "test_sandbox_";

/** `test-sandbox-command-1699999999999`, or without the label `test-sandbox-1699999999999` */
export const testName = (label?: string) =>
	`${TEST_NAME_PREFIX}${label ? `${label}-` : ""}${Date.now()}`;

/** `test_sandbox_command_1699999999999` */
export const testIdentifier = (label?: string) =>
	`${TEST_IDENTIFIER_PREFIX}${label ? `${label}_` : ""}${Date.now()}`;

/** Whether a sandbox was created by this suite */
export const isTestSandbox = (sandbox: {
	name?: string | undefined;
	identifier?: string | undefined;
}) =>
	sandbox.identifier?.startsWith(TEST_IDENTIFIER_PREFIX) === true ||
	sandbox.name?.startsWith(TEST_NAME_PREFIX) === true;
