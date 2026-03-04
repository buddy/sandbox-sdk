import { Sandbox } from "@buddy-works/sandbox-sdk";
import { log } from "@/shared/logger";

log("Sandbox Apps Example\n");

const identifier = "apps-demo-sandbox";

let sandbox: Sandbox;

try {
	sandbox = await Sandbox.getByIdentifier(identifier);
	log(`Found existing sandbox with identifier: ${identifier}, deleting...`);
	await sandbox.destroy();
} catch {
	// Sandbox doesn't exist, nothing to delete
}

log(`Creating sandbox with 2 apps...`);
sandbox = await Sandbox.create({
	identifier,
	name: "Apps Demo Sandbox",
	os: "ubuntu:24.04",
	first_boot_commands: "apt-get update && apt-get install -y curl",
	apps: [
		"while true; do echo \"[app1] ping $(date)\"; sleep 2; done",
		"while true; do echo \"[app2] pong $(date)\"; sleep 3; done",
	],
});
log(`Created sandbox: ${sandbox.data.identifier} (${sandbox.data.html_url})`);
log(`Status: ${sandbox.data.status}, Setup: ${sandbox.data.setup_status}\n`);

log("Apps:");
for (const app of sandbox.data.apps ?? []) {
	log(`  ${app.id}: "${app.command}" -> ${app.app_status}`);
}

const firstApp = sandbox.data.apps?.[0];
const secondApp = sandbox.data.apps?.[1];

if (!firstApp?.id || !secondApp?.id) {
	throw new Error("Expected 2 apps in sandbox");
}

log(`\nStopping the first app (${firstApp.id})...`);
await sandbox.stopApp(firstApp.id);
log("Apps after stopping the first one:");
for (const app of sandbox.data.apps ?? []) {
	log(`  ${app.id}: ${app.app_status}`);
}

log(`\nStarting the first app (${firstApp.id})...`);
await sandbox.startApp(firstApp.id);
log("Apps after starting the first one:");
for (const app of sandbox.data.apps ?? []) {
	log(`  ${app.id}: ${app.app_status}`);
}

log("\nWaiting a few seconds for log output...");
await new Promise((resolve) => setTimeout(resolve, 5000));

log(`Getting logs for the second app (${secondApp.id})...`);
const logs = await sandbox.getAppLogs(secondApp.id);
log(`Logs (${logs.logs?.length ?? 0} entries):`);
for (const entry of logs.logs ?? []) {
	log(`  ${entry}`);
}

log("\nCleaning up...");
await sandbox.destroy();
log("Sandbox deleted successfully");
