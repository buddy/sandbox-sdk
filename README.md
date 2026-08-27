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

Set the environment variables:

```bash
export BUDDY_TOKEN="your-api-token"
export BUDDY_WORKSPACE="your-workspace"
export BUDDY_PROJECT="your-project"  # Optional: see Scopes below
export BUDDY_ENVIRONMENT="your-environment"  # Optional: see Scopes below
export BUDDY_REGION="US"  # Optional: US (default), EU, or AS
```

Only the token and the workspace are required - the project and the environment decide where new sandboxes land.

## Scopes

A sandbox lives in a project, in an environment, or directly in the workspace.
You never set the scope explicitly - it follows from the project and environment
you configure. Both come either from env vars (`BUDDY_PROJECT`,
`BUDDY_ENVIRONMENT`) or from the `connection` object you can pass to any call to
override them - see [Connection overrides](#connection-overrides).

| Project | Environment | Where the sandbox is created | Scope |
|---|---|---|---|
| `my-project` | – | in that project | `PROJECT` |
| – | `staging` | in the workspace-level environment `staging` | `ENVIRONMENT` |
| `my-project` | `staging` | in the environment `staging` **belonging to `my-project`** | `ENVIRONMENT` |
| – | – | in the workspace itself | `WORKSPACE` |

Giving both is not a conflict. Environments belong either to a project or to the
workspace, and the project decides which of the two `staging` means - nothing
else. The sandbox is scoped to the environment either way; it never ends up in
the project.

```typescript
// in a project
await Sandbox.create({ connection: { project: "my-project" } });

// in an environment of that project
await Sandbox.create({
    connection: { project: "my-project", environment: "staging" },
});

// in the workspace - nothing configured at all
await Sandbox.create();

// in the workspace despite a globally set BUDDY_PROJECT
await Sandbox.create({ connection: { project: undefined } });
```

The environment identifier is resolved to an ID on first use and cached for the
lifetime of the client. Pass `connection.environmentId` to skip that lookup.

A `connection` object that mentions `project`, `environment` or `environmentId`
decides the scope on its own - a globally set `BUDDY_PROJECT` will not turn a
per-call `{ environment: "staging" }` override into a project sandbox, nor the
other way round. Mentioning the key is what counts, not its value:
`connection: { project: undefined }` asks for workspace scope even with
`BUDDY_PROJECT` set, and `{ environment: undefined }` says "no environment" -
the project then comes from wherever it normally would.

`{ environment: "staging" }` does still borrow `BUDDY_PROJECT` to look the
identifier up, because that is where most environments live and the scope is
already settled by then. Add `project: undefined` next to it to force a
workspace-level environment.

`Sandbox.list()` and `Sandbox.listSnapshots()` return one scope at a time,
mirroring the API - listing across scopes means one call per scope.

> **Heads up when upgrading.** A missing `BUDDY_PROJECT` used to throw. It now
> means workspace scope, so double-check your environment.

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
