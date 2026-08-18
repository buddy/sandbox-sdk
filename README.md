# Buddy Sandbox SDK

TypeScript SDK for managing Buddy sandboxes - isolated Ubuntu environments for running commands.

## Installation

```bash
npm install @buddy-works/sandbox-sdk
```

## Usage

```typescript
import { Sandbox } from "@buddy-works/sandbox-sdk";

const identifier = "my-sandbox";

let sandbox: Sandbox;

try {
    sandbox = await Sandbox.getByIdentifier(identifier);
} catch {
    sandbox = await Sandbox.create({
        identifier,
        name: "My Sandbox",
        os: "ubuntu:24.04",
    });
}

await sandbox.start();

await sandbox.runCommand({
    command: "ping -c 5 buddy.works",
});

await sandbox.stop();
```

Set required environment variables:

```bash
export BUDDY_TOKEN="your-api-token"
export BUDDY_WORKSPACE="your-workspace"
export BUDDY_PROJECT="your-project"
export BUDDY_REGION="US"  # Optional: US (default), EU, or AS
```

## Waiting for readiness

`Sandbox.create()` blocks until the sandbox has finished setup and reached
`RUNNING`, so the instance it returns is ready to use. While waiting it polls
the API on a backoff starting at 100ms and growing to 500ms.

Pass `wait: false` to skip the wait and drive it yourself. The instance you get
back carries everything the create call returned - `id`, `identifier`, `url`,
`resources` - but connection details are not settled yet.

```typescript
const sandbox = await Sandbox.create({ identifier: "my-sandbox", wait: false });

// ... do other work while the sandbox boots ...

await sandbox.waitUntilReady();   // setup_status: SUCCESS
await sandbox.waitUntilRunning(); // status: RUNNING
```

The waiters accept an explicit interval, which pins polling to that fixed value
instead of backing off:

```typescript
await sandbox.waitUntilRunning(500); // check every 500ms
```

## Apps

Sandboxes can run multiple apps simultaneously. Each app is a long-running process defined by a command string.

```typescript
const sandbox = await Sandbox.create({
    identifier: "my-sandbox",
    name: "My Sandbox",
    os: "ubuntu:24.04",
    first_boot_commands: "apt-get update && apt-get install -y curl",
    apps: ["node server.js", "python worker.py"],
    timeout: 600, // auto-stop after 10 minutes of inactivity
});

// List apps
for (const app of sandbox.data.apps ?? []) {
    console.log(`${app.id}: "${app.command}" -> ${app.app_status}`);
}

// Control individual apps
const appId = sandbox.data.apps![0].id!;

await sandbox.stopApp(appId);
await sandbox.startApp(appId);

const { logs } = await sandbox.getAppLogs(appId);
console.log(logs);
```

## Fetching repositories and artifacts

Use `fetch` to clone repositories or download artifacts into the sandbox on
first boot. Each entry sets a `type` (`PROJECT_REPO`, `PUBLIC_REPO`, or
`ARTIFACT`) plus the fields relevant to it.

```typescript
await Sandbox.create({
    identifier: "my-sandbox",
    fetch: [
        {
            type: "PUBLIC_REPO",
            repository: "https://github.com/octocat/Hello-World",
            ref: "master",
            path: "/workspace/hello",
            build_command: "echo built",
        },
    ],
});
```

## Updating a sandbox

Use `sandbox.update()` to change configuration after creation - `timeout`, `apps`, `endpoints`, `variables`, `tags`, etc. The internal state is updated with the API's response.

```typescript
const sandbox = await Sandbox.getByIdentifier("my-sandbox");

await sandbox.update({
    timeout: 1200,
    tags: ["staging", "feature-x"],
});
```

## Snapshots

Take point-in-time snapshots of a sandbox and restore from them later. Each snapshot is returned as a `Snapshot` instance with its own methods.

```typescript
const sandbox = await Sandbox.getByIdentifier("my-sandbox");

// Create a snapshot. Returns immediately with status "CREATING".
const snapshot = await sandbox.createSnapshot({ name: "before-deploy" });

// Wait until the snapshot is "CREATED" before using it.
await snapshot.waitUntilReady();

// Create a new sandbox from the snapshot.
const restored = await Sandbox.createFromSnapshot(snapshot.id, {
    name: "restored-sandbox",
});

// List all snapshots for this sandbox.
const snapshots = await sandbox.listSnapshots();

// Delete a snapshot.
await snapshot.delete();
```

If you already have a snapshot ID from elsewhere (e.g. persisted in your own storage), get the entity directly:

```typescript
const snapshot = await Sandbox.getSnapshotById(sandboxId, snapshotId);
```

Equivalent convenience methods on `Sandbox` are available when you only have an ID and don't want to fetch the `Snapshot` first:

```typescript
await sandbox.waitForSnapshotReady(snapshotId);
await sandbox.deleteSnapshot(snapshotId);
```

## Regions

Configure the API region:

```bash
# Via environment variable (recommended)
export BUDDY_REGION="EU"
```

```typescript
// Or via connection config
const sandbox = await Sandbox.create({
    identifier: "my-sandbox",
    name: "My Sandbox",
    os: "ubuntu:24.04",
    connection: {
        region: "EU"  // US, EU, or AS
    }
});
```

## Connection overrides

Override workspace/auth per call:

```typescript
await Sandbox.create({
    identifier: "my-sandbox",
    name: "My Sandbox",
    os: "ubuntu:24.04",
    connection: {
        workspace: "different-workspace",
        project: "different-project",
        token: "custom-token",
        region: "EU"
    }
});
```
