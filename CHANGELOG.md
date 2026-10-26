# Changelog

## 0.2.1

Sandbox commands run through the API's new execs. The API drops the old
command endpoints, so in 0.2.0 and earlier `runCommand()`, `listCommands()`
and everything on `Command` stop working once that API change is live -
upgrade to keep running commands. `exec()` is not affected.

### Breaking

A command's log no longer tells stdout and stderr apart. `logs()` yields plain
lines, `stdout()` and `stderr()` are gone, and `runCommand()` takes a single
`output` stream:

```diff
- await sandbox.runCommand({ command, stdout: process.stdout, stderr: process.stderr });
+ await sandbox.runCommand({ command, output: process.stdout });

- for await (const { type, data } of command.logs({ follow: true })) {}
+ for await (const line of command.logs({ follow: true })) {}

- const errors = await command.stderr();
+ const everything = await command.output(); // stdout and stderr interleaved
+ const { stderr } = await sandbox.exec({ command }); // kept apart, up to 60s
```

`command.data` is the API's execution view:

- `id` is now `execution_id`, also available as `command.id`,
- `start_date`, `finish_date` and `logs_url` are now `started_at`,
  `finished_at` and `log_url`,
- `status` can be `CANCELLED`, which is what `kill()` ends with instead of
  `FAILED` with exit code 143.

Starting and cancelling a command needs the `SANDBOX_USE` token scope, which
`SANDBOX_WRITE` includes. Reading a sandbox's command history and logs needs
run access to it; read-only access no longer shows them.

### Added

- `command.id`, and the `ExecView` type behind `command.data`.
- `listCommands({ limit })`. The API keeps the 200 most recent commands.
- `failure_reason`, `error_message` and `truncated` on a command's data.
- `wait()`, `logs()` and `output()` take a `signal` that stops waiting, for a
  deadline; `kill()` then stops the command itself.

### Changed

- `wait()` lets the API hold the request until the command finishes instead of
  polling, and `logs({ follow: true })` reads the log page by page.
- `kill()` resolves once the command has stopped, or after 30 seconds.
- Commands are limited to 3 at once per member in one sandbox and 10 per
  workspace across sandboxes and targets (plan-dependent); over a limit, the
  API answers HTTP 409. Each command may be up to 16 KB long and 90 minutes.
- A variable without a `type` is sent as `type: "VAR"`, the default the API
  applies anyway.

## 0.2.0

Sandbox apps have names now: you start, stop and read logs for an app by a name
you picked, instead of by the ID the API generated for it.

### Breaking

`apps` on `Sandbox.create()` and `Sandbox.createFromSnapshot()` takes objects
instead of bare command strings:

```diff
- apps: ["node server.js"]
+ apps: [{ identifier: "api", command: "node server.js" }]
```

`identifier` is optional - leave it out and the API derives one from the run
command (`sleep 600` becomes `sleep_600`). The API itself still accepts the old
string form, so this only breaks the SDK's own validation; nothing deployed
stops working until you upgrade.

### Added

- Apps carry an `identifier` and a `path` (the directory the app runs in,
  defaulting to the sandbox's `app_dir`).
- `startApp()`, `stopApp()` and `getAppLogs()` accept either an app's
  `identifier` or its generated `id`.

## Earlier releases

- **0.1.11** (2026-10-09) - requests go over HTTP/2 by default, with uploads,
  downloads and log streaming sharing one transport.
- **0.1.10** (2026-10-07) - `exec()` runs a command and waits for its result.
- **0.1.9** (2026-09-09) - stopped retrying non-idempotent requests after an
  ambiguous failure, which could create a second sandbox or run a command twice.
- **0.1.8** (2026-08-18) - polling, the ASIA region and a CJS build.
- **0.1.7** (2026-06-02) - spec fix.
- **0.1.6** (2026-05-21) - sandbox update and snapshots, sandbox timeout and
  fetching repositories and artifacts.
- **0.1.5** (2026-03-20) - sandbox apps.
- **0.1.4** (2026-01-30) - smaller bundle.
- **0.1.3** (2026-01-30) - `BuddyApiClient.getIdentifiers()`.
- **0.1.0** - **0.1.2** (2026-01-26 - 2026-01-27) - first public releases.
