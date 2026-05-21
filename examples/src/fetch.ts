import { Sandbox } from "@buddy-works/sandbox-sdk";
import { log } from "@/shared/logger";

log("Fetch Example\n");

const identifier = "fetch-demo-sandbox";

try {
	const existing = await Sandbox.getByIdentifier(identifier);
	log(`Found existing sandbox with identifier: ${identifier}, deleting...`);
	await existing.destroy();
} catch {
	// Sandbox doesn't exist, nothing to delete
}

let sandbox: Sandbox | undefined;
try {
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
	log(
		`Created sandbox: ${sandbox.data.identifier} (${sandbox.data.html_url})\n`,
	);

	log("Listing the cloned directory:");
	const ls = await sandbox.runCommand({
		command: "ls -la /workspace/hello-world",
		stdout: null,
		stderr: null,
	});
	const finished = await ls.wait();
	const output = await finished.stdout();
	log(output);
} finally {
	if (sandbox) {
		log("Cleaning up...");
		await sandbox.destroy().catch(() => undefined);
		log("Sandbox deleted successfully");
	}
}
