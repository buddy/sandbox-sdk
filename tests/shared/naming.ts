/**
 * The suite runs against a shared workspace, so everything it creates carries
 * one prefix - visible in the UI, and enough for the teardown to sweep by.
 */
export const TEST_PREFIX = "sandboxsdk_";

/** `sandboxsdk_command-test-1699999999999` */
export const testName = (label: string) =>
	`${TEST_PREFIX}${label}-${Date.now()}`;

/** `sandboxsdk_command_test_1699999999999` */
export const testIdentifier = (label: string) =>
	`${TEST_PREFIX}${label}_${Date.now()}`;

/** Whether a sandbox was created by this suite */
export const isTestSandbox = (sandbox: {
	name?: string | undefined;
	identifier?: string | undefined;
}) =>
	sandbox.identifier?.startsWith(TEST_PREFIX) === true ||
	sandbox.name?.startsWith(TEST_PREFIX) === true;
