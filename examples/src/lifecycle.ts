import { Sandbox } from "@buddy-works/sandbox-sdk";
import { log } from "@/shared/logger";

log("Sandbox Lifecycle Example\n");

const identifier = "lifecycle-demo-sandbox";

let sandbox: Sandbox;

const list = await Sandbox.list({ simple: true });
const id = list.find((s) => s.identifier === identifier)?.id;

if (id) {
	log(`Found existing sandbox with identifier: ${identifier}, deleting...`);
	sandbox = await Sandbox.getById(id);
	await sandbox.destroy();
}

log(`Creating sandbox with identifier: ${identifier}`);
sandbox = await Sandbox.create({
	identifier,
	name: "Lifecycle Demo Sandbox",
	os: "ubuntu:24.04",
});
log(`Created sandbox: ${sandbox.data.identifier} (${sandbox.data.html_url})`);
log(`Status: ${sandbox.data.status}, Setup: ${sandbox.data.setup_status}\n`);

log("Running command: uptime");
await sandbox.runCommand({
	command: "uptime",
});

log("\nStopping sandbox...");
await sandbox.stop();
log(`Sandbox stopped. Status: ${sandbox.data.status}\n`);

log("Starting sandbox...");
await sandbox.start();
log(`Sandbox started. Status: ${sandbox.data.status}\n`);

log("Running command: df -h");
await sandbox.runCommand({
	command: "df -h",
});

log("\nRestarting sandbox...");
await sandbox.restart();
log(`Sandbox restarted. Status: ${sandbox.data.status}\n`);

log("Running final command: hostname");
await sandbox.runCommand({
	command: "hostname",
});

log("\nCleaning up...");
await sandbox.destroy();
log("Sandbox deleted successfully");
