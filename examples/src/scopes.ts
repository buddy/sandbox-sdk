import { Sandbox } from "@buddy-works/sandbox-sdk";
import { log } from "@/shared/logger";

/**
 * A sandbox lives in a project, in an environment, or directly in the
 * workspace, and the scope follows from the connection. Both parts below pin
 * theirs explicitly, so the labels hold whatever your .env contains.
 */

const projectName = process.env["BUDDY_PROJECT"];
// Passed as arguments, not env vars: BUDDY_ENVIRONMENT is read by the SDK
// itself and would move every other example into that environment.
const environmentIdentifier = process.argv[2];
const environmentProject = process.argv[3];

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
	connection: { scope: "WORKSPACE" },
});
log(`  ${workspaceSandboxes.length} workspace-level sandbox(es)\n`);

if (environmentIdentifier) {
	log(`Environment scope (${environmentIdentifier}):`);

	const sandbox = await Sandbox.create({
		name: "Scoped sandbox",
		identifier: `scoped_sandbox_${String(Date.now())}`,
		os: "ubuntu:24.04",
		// A project-level environment is only found through its project.
		connection: {
			project: environmentProject,
			environment: environmentIdentifier,
		},
	});

	log(`  Scope: ${sandbox.data.scope}`);
	log(`  Environment: ${sandbox.data.environment?.identifier}`);

	await sandbox.destroy();
	log("  Cleaned up\n");
} else {
	log(
		"Environment scope skipped - run `pnpm example:scopes <environment> [project]`.\n",
	);
}

log("Scopes example completed!");
