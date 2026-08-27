import { Sandbox } from "@buddy-works/sandbox-sdk";
import { log } from "@/shared/logger";

/**
 * Sandbox scopes.
 *
 * A sandbox lives in a project, in an environment, or directly in the
 * workspace. You never set the scope explicitly - it follows from the project
 * and environment in the connection. Each part below pins its scope explicitly
 * rather than relying on the env vars, so the labels stay true whatever your
 * .env happens to contain.
 *
 * Set BUDDY_ENVIRONMENT to run the environment part.
 */

const projectName = process.env["BUDDY_PROJECT"];
const environmentIdentifier = process.env["BUDDY_ENVIRONMENT"];

log("Sandbox Scopes Example\n");

if (projectName) {
	log(`Project scope (${projectName}):`);

	const projectSandboxes = await Sandbox.list({
		connection: { project: projectName },
	});
	log(`  ${projectSandboxes.length} sandbox(es) in the project\n`);
} else {
	log("Project scope skipped - set BUDDY_PROJECT to try it.\n");
}

log("Workspace scope (no project, no environment):");
const workspaceSandboxes = await Sandbox.list({
	connection: { project: undefined, environment: undefined },
});
log(`  ${workspaceSandboxes.length} workspace-level sandbox(es)\n`);

if (environmentIdentifier) {
	log(`Environment scope (${environmentIdentifier}):`);

	// No project passed: an environment identifier is looked up in
	// BUDDY_PROJECT first and among workspace-level environments after, so
	// this works whichever kind you point it at.
	const environmentSandboxes = await Sandbox.list({
		connection: { environment: environmentIdentifier },
	});
	log(`  ${environmentSandboxes.length} sandbox(es) in the environment\n`);

	log("Creating a sandbox in the environment...");
	const sandbox = await Sandbox.create({
		name: "Scoped sandbox",
		identifier: `scoped_sandbox_${String(Date.now())}`,
		os: "ubuntu:24.04",
		connection: { environment: environmentIdentifier },
	});

	log(`  Scope: ${sandbox.data.scope}`);
	log(`  Environment: ${sandbox.data.environment?.identifier}`);
	log(`  Project: ${sandbox.data.project?.name ?? "none"}`);

	await sandbox.destroy();
	log("  Cleaned up\n");
} else {
	log("Environment scope skipped - set BUDDY_ENVIRONMENT to try it.\n");
}

log("Scopes example completed!");
