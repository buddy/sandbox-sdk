# Buddy Sandbox SDK

TypeScript SDK for managing Buddy sandboxes - isolated Ubuntu environments for running commands.

## Installation

```bash
npm install @buddy-works/sandbox-sdk
```

## Usage

```typescript
import {Sandbox} from "@buddy-works/sandbox-sdk";

const sandbox = await Sandbox.create({
    identifier: "my-sandbox",
    name: "My Sandbox",
    os: "ubuntu:24.04",
});

await sandbox.runCommand({
    command: "ping -c 5 8.8.8.8",
});
```

Set required environment variables:

```bash
export BUDDY_TOKEN="your-api-token"
export BUDDY_WORKSPACE="your-workspace"
export BUDDY_PROJECT="your-project"
export BUDDY_REGION="US"  # Optional: US (default), EU, or AP
```

## Regions

Configure the API region:

```typescript
// Via environment variable (recommended)
export
BUDDY_REGION = "EU"

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
