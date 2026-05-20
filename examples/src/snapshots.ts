import { Sandbox } from "@buddy-works/sandbox-sdk";
import { log } from "@/shared/logger";

log("Snapshots Example\n");

const baseIdentifier = "snapshot-demo-base";
const restoredIdentifier = "snapshot-demo-restored";

// Cleanup any leftovers from previous runs
for (const id of [baseIdentifier, restoredIdentifier]) {
	try {
		const existing = await Sandbox.getByIdentifier(id);
		log(`Found existing sandbox '${id}', deleting...`);
		await existing.destroy();
	} catch {
		// not present
	}
}

log("Creating base sandbox...");
const base = await Sandbox.create({
	identifier: baseIdentifier,
	name: "Snapshot Demo Base",
	os: "ubuntu:24.04",
});
log(`Created base sandbox: ${base.data.identifier} (${base.data.html_url})\n`);

log("Uploading a marker file to the base sandbox...");
const markerFilename = "snapshot-marker.txt";
const markerContent = `created at ${new Date().toISOString()}`;
await base.fs.uploadFile(Buffer.from(markerContent), markerFilename);
log(`Wrote '${markerFilename}' with content: ${markerContent}\n`);

log("Creating a snapshot (returns immediately with status CREATING)...");
const snapshot = await base.createSnapshot({ name: "demo-snapshot" });
log(`Snapshot id=${snapshot.id} initial status=${snapshot.data.status}\n`);

log("Waiting until snapshot is CREATED...");
const start = Date.now();
await snapshot.waitUntilReady();
log(
	`Snapshot ready in ${Date.now() - start}ms (status=${snapshot.data.status})\n`,
);

log("Listing snapshots for the base sandbox:");
const snapshots = await base.listSnapshots();
for (const s of snapshots) {
	log(`  ${s.id}  ${s.data.name}  ${s.data.status}`);
}

log("\nCreating a new sandbox from the snapshot...");
const restored = await Sandbox.createFromSnapshot(snapshot.id, {
	identifier: restoredIdentifier,
	name: "Snapshot Demo Restored",
});
log(
	`Restored sandbox: ${restored.data.identifier} (${restored.data.html_url})`,
);
log(`Status: ${restored.data.status}\n`);

log("Verifying the marker file is present in the restored sandbox...");
const downloaded = await restored.fs.downloadFile(markerFilename);
const matches = downloaded.toString() === markerContent;
log(`Marker content matches: ${matches}\n`);

log("Cleaning up...");
await restored.destroy();
await snapshot.delete();
await base.destroy();
log("All resources deleted successfully");
