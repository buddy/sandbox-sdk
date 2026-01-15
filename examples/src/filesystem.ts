import { FileSystem, Sandbox } from "@buddy-works/sandbox-sdk";
import { log } from "@/shared/logger";

log("FileSystem Operations Example\n");

const identifier = "filesystem-demo-sandbox";

log(`Getting or creating sandbox: ${identifier}`);

let sandbox: Sandbox;

const list = await Sandbox.list({ simple: true });
const id = list.find((s) => s.identifier === identifier)?.id;

if (id) {
	sandbox = await Sandbox.getById(id);
	log(
		`Found existing sandbox: ${sandbox.data.identifier} (${sandbox.data.html_url})`,
	);
} else {
	log("Creating new sandbox...");
	sandbox = await Sandbox.create({
		identifier,
		name: "FileSystem Demo Sandbox",
		os: "ubuntu:24.04",
	});
	log(`Created sandbox: ${sandbox.data.identifier} (${sandbox.data.html_url})`);
}

log("\n=== Direct FileSystem Usage ===");
log("Creating FileSystem directly from sandbox ID...");

const sandboxId = sandbox.data.id;
if (!sandboxId) {
	throw new Error("Sandbox ID is required");
}

const directFs = FileSystem.forSandbox(sandboxId);
const homeFiles = await directFs.listFiles("/home");
log(`Direct FileSystem found ${homeFiles.length} items in /home:`);
for (const file of homeFiles) {
	log(`  ${file.type === "DIR" ? "[DIR]" : "[FILE]"} ${file.name}`);
}

log("\n=== Example 1: Listing Files ===");
log("Listing contents of /etc directory (first 10 items)...");

const files = await sandbox.fs.listFiles("/etc");
log(`Found ${files.length} items:`);
for (const file of files.slice(0, 10)) {
	const typeIcon = file.type === "DIR" ? "[DIR]" : "[FILE]";
	const size = file.size ? ` (${file.size} bytes)` : "";
	log(`  ${typeIcon} ${file.name}${size}`);
}
if (files.length > 10) {
	log(`  ... and ${files.length - 10} more`);
}

log("\n=== Example 2: Creating Directories ===");
log("Creating directory structure: /buddy/demo/data");

await sandbox.fs.createFolder("/buddy/demo");
await sandbox.fs.createFolder("/buddy/demo/data");
log("Directories created successfully");

const demoFiles = await sandbox.fs.listFiles("/buddy/demo");
log(`Contents of /buddy/demo: ${demoFiles.map((f) => f.name).join(", ")}`);

log("\n=== Example 3: Uploading Files ===");

const configContent = JSON.stringify(
	{ version: "1.0.0", name: "demo" },
	null,
	2,
);
await sandbox.fs.uploadFile(
	Buffer.from(configContent),
	"/buddy/demo/config.json",
);
log("Uploaded config.json from buffer");

await Promise.all([
	sandbox.fs.uploadFile(
		Buffer.from("Hello from file 1!"),
		"/buddy/demo/data/file1.txt",
	),
	sandbox.fs.uploadFile(
		Buffer.from("Hello from file 2!"),
		"/buddy/demo/data/file2.txt",
	),
]);
log("Uploaded 2 files to /buddy/demo/data/");

log("\n=== Example 4: Downloading Files ===");

const downloadedConfig = await sandbox.fs.downloadFile(
	"/buddy/demo/config.json",
);
log(`Downloaded config.json (${downloadedConfig.length} bytes):`);
log(`  Content: ${downloadedConfig.toString()}`);

const [file1Content, file2Content] = await Promise.all([
	sandbox.fs.downloadFile("/buddy/demo/data/file1.txt"),
	sandbox.fs.downloadFile("/buddy/demo/data/file2.txt"),
]);
log("Downloaded multiple files:");
log(`  file1.txt: "${file1Content.toString()}"`);
log(`  file2.txt: "${file2Content.toString()}"`);

log("\n=== Example 5: Deleting Files ===");

await sandbox.fs.deleteFile("/buddy/demo/data/file1.txt");
log("Deleted file1.txt");

await sandbox.fs.deleteFile("/buddy/demo/data/file2.txt");
log("Deleted file2.txt");

await sandbox.fs.deleteFile("/buddy/demo/data");
log("Deleted /buddy/demo/data directory");

await sandbox.fs.deleteFile("/buddy/demo/config.json");
log("Deleted config.json");

await sandbox.fs.deleteFile("/buddy/demo");
log("Deleted /buddy/demo directory");

const finalFiles = await sandbox.fs.listFiles("/buddy");
log(
	`Contents of /buddy after cleanup: ${
		finalFiles.map((f) => f.name).join(", ") || "(empty)"
	}`,
);

log("\nFileSystem example completed!");
