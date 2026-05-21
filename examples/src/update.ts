import { Sandbox } from "@buddy-works/sandbox-sdk";
import { log } from "@/shared/logger";

log("Sandbox Update Example\n");

const identifier = "update-demo-sandbox";

try {
	const existing = await Sandbox.getByIdentifier(identifier);
	log(`Found existing sandbox with identifier: ${identifier}, deleting...`);
	await existing.destroy();
} catch {
	// Sandbox doesn't exist, nothing to delete
}

let sandbox: Sandbox | undefined;
try {
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
} finally {
	if (sandbox) {
		log("Cleaning up...");
		await sandbox.destroy().catch(() => undefined);
		log("Sandbox deleted successfully");
	}
}
