import { Sandbox } from "@buddy-works/sandbox-sdk";
import { log } from "@/shared/logger";

log("Sandbox Apps Example\n");

const identifier = "apps-demo-sandbox";

try {
	const existing = await Sandbox.getByIdentifier(identifier);
	log(`Found existing sandbox with identifier: ${identifier}, deleting...`);
	await existing.destroy();
} catch {
	// Sandbox doesn't exist, nothing to delete
}

let sandbox: Sandbox | undefined;
try {
	log(`Creating sandbox with 2 apps...`);
	sandbox = await Sandbox.create({
		identifier,
		name: "Apps Demo Sandbox",
		os: "ubuntu:24.04",
		first_boot_commands: "apt-get update && apt-get install -y curl",
		apps: [
			{
				identifier: "app1",
				command: 'while true; do echo "[app1] ping $(date)"; sleep 2; done',
			},
			{
				identifier: "app2",
				command: 'while true; do echo "[app2] pong $(date)"; sleep 3; done',
			},
		],
	});
	log(`Created sandbox: ${sandbox.data.identifier} (${sandbox.data.html_url})`);
	log(`Status: ${sandbox.data.status}, Setup: ${sandbox.data.setup_status}\n`);

	log("Apps:");
	for (const app of sandbox.data.apps ?? []) {
		log(
			`  ${app.identifier} (${app.id}): "${app.command}" -> ${app.app_status}`,
		);
	}

	// apps are addressed by their identifier or by their generated id
	log("\nStopping app1...");
	await sandbox.stopApp("app1");
	log("Apps after stopping app1:");
	for (const app of sandbox.data.apps ?? []) {
		log(`  ${app.identifier}: ${app.app_status}`);
	}

	log("\nStarting app1...");
	await sandbox.startApp("app1");
	log("Apps after starting app1:");
	for (const app of sandbox.data.apps ?? []) {
		log(`  ${app.identifier}: ${app.app_status}`);
	}

	log("\nWaiting a few seconds for log output...");
	await new Promise((resolve) => setTimeout(resolve, 5000));

	log("Getting logs for app2...");
	const logs = await sandbox.getAppLogs("app2");
	log(`Logs (${logs.logs?.length ?? 0} entries):`);
	for (const entry of logs.logs ?? []) {
		log(`  ${entry}`);
	}
} finally {
	if (sandbox) {
		log("\nCleaning up...");
		await sandbox.destroy().catch(() => undefined);
		log("Sandbox deleted successfully");
	}
}
