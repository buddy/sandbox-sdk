import { Sandbox } from "@buddy-works/sandbox-sdk";
import { log } from "@/shared/logger";

log("Sandbox Update Example\n");

const identifier = "update-demo-sandbox";

let sandbox: Sandbox;

try {
	sandbox = await Sandbox.getByIdentifier(identifier);
	log(`Found existing sandbox with identifier: ${identifier}, deleting...`);
	await sandbox.destroy();
} catch {
	// Sandbox doesn't exist, nothing to delete
}

log("Creating sandbox with initial config...");
sandbox = await Sandbox.create({
	identifier,
	name: "Update Demo Sandbox",
	os: "ubuntu:24.04",
	timeout: 300,
	tags: ["initial"],
	apps: ["echo initial-app"],
});
log(`Created sandbox: ${sandbox.data.identifier} (${sandbox.data.html_url})`);
log(`Initial timeout: ${sandbox.data.timeout}`);
log(`Initial tags: ${(sandbox.data.tags ?? []).join(", ")}`);
log(
	`Initial apps: ${(sandbox.data.apps ?? []).map((a) => a.command).join(", ")}\n`,
);

log("Updating timeout (300 -> 1200), tags and apps in place...");
await sandbox.update({
	timeout: 1200,
	tags: ["updated", "demo"],
	apps: [{ command: "echo updated-app" }],
});
log(`Updated timeout: ${sandbox.data.timeout}`);
log(`Updated tags: ${(sandbox.data.tags ?? []).join(", ")}`);
log(
	`Updated apps: ${(sandbox.data.apps ?? []).map((a) => a.command).join(", ")}`,
);
log(
	`Sandbox status: ${sandbox.data.status} (setup: ${sandbox.data.setup_status})\n`,
);

log("Cleaning up...");
await sandbox.destroy();
log("Sandbox deleted successfully");
