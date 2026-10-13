# Changelog

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
