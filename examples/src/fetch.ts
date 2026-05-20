import { Sandbox } from "@buddy-works/sandbox-sdk";
import { log } from "@/shared/logger";

log("Fetch Example\n");

const identifier = "fetch-demo-sandbox";

let sandbox: Sandbox;

try {
	sandbox = await Sandbox.getByIdentifier(identifier);
	log(`Found existing sandbox with identifier: ${identifier}, deleting...`);
	await sandbox.destroy();
} catch {
	// Sandbox doesn't exist, nothing to delete
}

log("Creating sandbox that clones a public repository on first boot...");
sandbox = await Sandbox.create({
	identifier,
	name: "Fetch Demo Sandbox",
	os: "ubuntu:24.04",
	fetch: [
		{
			type: "PUBLIC_REPO",
			repository: "https://github.com/octocat/Hello-World",
			ref: "master",
			path: "/workspace/hello-world",
		},
	],
});
log(`Created sandbox: ${sandbox.data.identifier} (${sandbox.data.html_url})\n`);

log("Listing the cloned directory:");
const ls = await sandbox.runCommand({
	command: "ls -la /workspace/hello-world",
	stdout: null,
	stderr: null,
});
const finished = await ls.wait();
const output = await finished.stdout();
log(output);

log("Cleaning up...");
await sandbox.destroy();
log("Sandbox deleted successfully");
