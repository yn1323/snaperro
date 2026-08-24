# snaperro

[日本語](README_ja.md)

snaperro is a local mock proxy that records responses from real APIs and replays them as named scenarios. A Hono server and React control panel run in one process, while large and non-JSON bodies stay on streaming paths.

## Features

- Four modes: `proxy`, `record`, `mock`, and `smart`
- Create, edit, duplicate, search, and delete folders, scenarios, and recordings
- Portable ZIP import/export for folders and individual recordings, plus body upload/download
- Revision-aware commands and queries with Server-Sent Events synchronization
- A v2 store with content-addressed blobs, atomic metadata commits, and integrity checks

## Requirements

- Node.js 22.12 or newer
- npm, pnpm, or another compatible Node.js package manager

## Install and initialize

Add snaperro as a development dependency, then initialize the project.

```bash
pnpm add -D snaperro
pnpm exec snaperro init
```

`init` creates:

- `snaperro.config.ts`: a `configVersion: 2` configuration
- `.snaperro/v2`: a v2 store containing a sample folder and demo scenarios
- a `.snaperro/v2/` entry in `.gitignore`

An existing v2 store containing `store.json` is left unchanged. If migratable `.snaperro/files` data exists, `init` stops before writing configuration, ignore rules, or a sample store; run `migrate --dry-run` and `migrate` first. An empty legacy root or a root containing only `.gitkeep` does not trigger this guard. If only an incomplete v2 directory exists, initialization stops instead of overwriting it. Use `doctor` to verify an existing store.

## Start

```bash
pnpm exec snaperro start
```

By default, snaperro listens on `127.0.0.1:3333` and opens the control panel.

- Control panel: `http://127.0.0.1:3333/__snaperro__/client`
- Demo: `http://127.0.0.1:3333/__snaperro__/demo`
- Proxied API: send configured routes to the same origin, for example `http://127.0.0.1:3333/users`

The configuration file is watched for changes. Pass `--no-watch` to disable watching. Changes to listener or storage boundaries, such as host, port, or storage root, require a restart.

## Configuration

The smallest practical configuration looks like this. `storage.root` is resolved relative to the configuration file.

```ts
import { defineConfig } from "snaperro";

export default defineConfig({
  configVersion: 2,
  server: {
    host: "127.0.0.1",
    port: 3333,
  },
  storage: {
    root: ".snaperro/v2",
  },
  mock: {
    fallback: "404",
  },
  apis: {
    example: {
      name: "Example API",
      target: "https://api.example.com",
      routes: ["GET /api/users", "POST /api/users", "/api/users/:id"],
      headers: {},
      maskRequestHeaders: ["authorization", "cookie"],
    },
  },
});
```

Important defaults:

| Setting | Default | Purpose |
| --- | --- | --- |
| `server.host` | `127.0.0.1` | Listener host |
| `server.port` | `3333` | Listener port |
| `server.openBrowser` | `true` | Open the control panel on startup |
| `server.allowedOrigins` | `[]` | Explicit origins allowed to use the control plane |
| `storage.root` | `.snaperro/v2` | v2 store location |
| `storage.maxImportBytes` | 512 MiB | Upload and expanded-archive limit |
| `recording.maxRequestBodyBytes` | 256 MiB | Maximum request body captured for recording |
| `recording.completeOnClientDisconnect` | `true` | Finish recording an upstream response after client disconnect |
| `mock.fallback` | `404` | Behavior when no recording matches |

Configuration is strict: unknown keys and ambiguous routes are rejected at startup. The built-in `jsonPlaceholder` API is always included and can be replaced with a user entry using the same key. A different API key cannot declare a route that conflicts with a built-in route.

`mock.fallback` accepts `404`, `proxy`, or `proxy&record`. `recording.maskRequestHeaders` applies globally, while an API's `maskRequestHeaders` applies only to that API. For corporate networks, configure an upstream proxy through `proxy.url`, or through `HTTPS_PROXY`, `HTTP_PROXY`, and then their lowercase equivalents. The explicit configuration always wins.

See [Configuration](docs/features/configuration.md) for every setting.

## Four modes

| Mode | Recording exists | Recording is missing | Persistence |
| --- | --- | --- | --- |
| `proxy` | Forward upstream | Forward upstream | None |
| `record` | Forward upstream | Forward upstream | Record the response in the selected scenario |
| `mock` | Return the matching response | Follow `mock.fallback` | Only when fallback is `proxy&record` |
| `smart` | Return the matching response | Forward upstream | Record responses that were not found |

Matching uses the method, route, path parameters, normalized query fields, and a request-body fingerprint. Select a scenario before using a mode that reads or writes recordings.

## Control panel

The React control panel supports:

- Switching the mode and current scenario
- Creating, renaming, deleting, importing, and exporting folders
- Creating, renaming, duplicating, and deleting scenarios
- Paginated recording lists; metadata, header, and body search; JSON/ZIP import; editing; deletion; and portable ZIP export
- Request/response body upload and download, JSON-editor match navigation, and request logs; server search also covers filenames and detached, unencoded body bytes

Updates use catalog, scenario, and recording revisions. If another window or process updates an item first, snaperro reports a conflict instead of overwriting newer data. A missing event or server restart triggers a fresh snapshot.

## Large responses and storage

Request and response bodies are never embedded in metadata JSON. Raw bytes are stored as SHA-256 blobs and stay streamed during traffic, recording, import, export, and download. A large response therefore does not become one huge JSON response or an in-memory buffer.

Downloads use short-lived, single-use capabilities handed to the browser's native download path. The control token never enters the URL, and browsers without the File System Access API do not need to load large files into JavaScript memory.

Folders, scenarios, and recordings use stable IDs independent of display names. A new immutable scenario manifest is stored first; the catalog manifest pointer is committed atomically last. A deletion disappears from queries and the UI at that catalog commit, while unreferenced blobs are reclaimed later after a safety grace period.

See [File storage](docs/features/file-storage.md) for the layout and crash-consistency rules.

## Migrate existing data

Stop the server, then run:

```bash
pnpm exec snaperro migrate --dry-run
pnpm exec snaperro migrate
# Replace the old configuration with a configVersion: 2 configuration.
pnpm exec snaperro doctor
```

The default source is `.snaperro/files` plus `.snaperro/state.json`; the destination is `.snaperro/v2`. Migration is copy-on-write and never modifies the source files. A separate staging store is fully built and verified before it becomes the destination. Source fingerprints are streamed; legacy recording JSON is capped at 256 MiB per file and v1 state at 1 MiB before parsing.

The data migrator does not rewrite executable TypeScript configuration. Update an existing config to the `configVersion: 2` shape shown above before `doctor` or `start`; `init` deliberately never overwrites an existing config file.

If an existing destination cannot be proven to be the result of the same migration, snaperro stops without overwriting it. `init`, `start`, and `doctor` also reject migratable v1 data paired with an unrelated native or incomplete v2 store. The receipt protects source provenance and its original-byte blobs; normal renames and deletions in the migrated v2 catalog remain valid. Automation can consume `migrate --json` and `doctor --json`. See [Migration](docs/features/migration.md) for details.

## CLI

| Command | Purpose | Main options |
| --- | --- | --- |
| `snaperro init` | Initialize configuration and a sample v2 store | None |
| `snaperro start` | Start the Hono server and React control panel | `--port`, `--config`, `--env`, `--no-watch`, `--skip-browser`, `--verbose` |
| `snaperro demo` | Open the demo on a running server | `--port`, `--config` |
| `snaperro postman` | Print a Postman collection covering every v2 command, query, and stream | None |
| `snaperro migrate` | Copy-on-write migration into the v2 store | `--source`, `--state`, `--destination`, `--dry-run`, `--json` |
| `snaperro doctor` | Read-only checks for config, Node.js, store metadata, and integrity | `--config`, `--env`, `--json` |

See [CLI](docs/features/cli.md) for details.

## Control-plane communication

The control panel uses typed commands and queries, body/import streams, and an event stream under `/__snaperro__/v2`. Shared Zod schemas validate both requests and responses. Mutating commands require expected revisions so conflicts are explicit.

Export and download queries do not mutate persistent data; they only issue an ephemeral download capability. The resulting `/__snaperro__/downloads/<capability>` path treats the capability itself as authorization and is valid for a short time and one claim only.

This is not a conventional resource-per-URL public API. Automation should follow the [Control API](docs/features/control-api.md) and [Event synchronization](docs/features/sse.md) contracts.

## Security

The server binds only to loopback `127.0.0.1` by default. Binding to a LAN or container interface requires a `server.controlToken` of at least 16 characters.

```ts
server: {
  host: "0.0.0.0",
  port: 3333,
  controlToken: process.env.SNAPERRO_CONTROL_TOKEN,
  allowedOrigins: ["https://tools.example.com"],
}
```

Control requests use `Authorization: Bearer <token>`. After a `401`, the control panel asks for the token and shares it between HTTP and event connections using page-private memory only. It disappears after reload, navigation, or tab close. Add a browser origin to `allowedOrigins` before using the control plane cross-origin. Never store the token in source control, URLs, or Web Storage. See [Security](docs/features/security.md).

## Development and CI

```bash
pnpm install
pnpm lint
pnpm type-check
pnpm type-check:client
pnpm type-check:demo
pnpm test:all
pnpm build
pnpm verify:package
```

Vitest covers the server, store, migration, CLI, and browser client at unit, contract, E2E, and performance levels. GitHub Actions runs lint and all three type checks, the complete test suite, the build, and package-content verification for pull requests and pushes to `main`.

## Documentation

- [Documentation index](docs/INDEX.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Folders, scenarios, and recordings](docs/features/scenario.md)
- [Modes](docs/features/modes.md)
- [GUI](docs/features/gui.md)
- [File storage](docs/features/file-storage.md)
- [Control API](docs/features/control-api.md)
- [Event synchronization](docs/features/sse.md)

## License

MIT
