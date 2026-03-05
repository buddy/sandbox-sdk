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
export BUDDY_REGION="US"  # Optional: US (default), EU, or AP
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
        region: "EU"  // US, EU, or AP
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
