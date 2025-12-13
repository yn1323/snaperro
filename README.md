# snaperro

<p align="center">
  <img src="https://raw.githubusercontent.com/yn1323/snaperro/main/logo.png" alt="snaperro Logo" width="200" />
</p>

A mock proxy server that records and replays responses from multiple APIs to streamline development and testing.

## Name Origin

- **snap**: snapshot, quickly capture
- **perro**: Spanish for "dog"
- The image of "a faithful dog that fetches data"

## Features

- **3 Modes**: Proxy (passthrough) / Record (capture) / Mock (playback)
- **Parameter Matching**: Accurate matching by path parameters and query parameters
- **State Persistence**: Mode and pattern settings persist across server restarts
- **TypeScript Configuration**: Type-safe configuration files

## Why snaperro?

Are you facing these problems during development?

- Depending on multiple APIs, making environment setup difficult
- Local development stops due to external API outages
- Preparing test data is tedious
- "I want to reproduce this state" but manually operating each time is a hassle

snaperro is a mock proxy server that saves API responses as "snapshots" and can replay them anytime.

---

## For Users

### Quick Start

```bash
# Install
npm install -D snaperro

# Initialize (generates .snaperro/, snaperro.config.ts)
npx snaperro init

# Start server
npx snaperro start
```

### Demo

We provide a demo environment where you can experience snaperro in action.

```bash
npx snaperro demo
```

Your browser will open `http://localhost:3333/__snaperro__/demo`.

#### Features You Can Try

| Feature | Description |
|---------|-------------|
| Mode Switching | Experience the differences between Proxy/Record/Mock modes |
| Path Parameter | Save and return different responses for each ID with `/users/:id` |
| Query String | Save and return different responses for each query with `/posts?userId=1` |
| Nested Resource | Fetch nested resources with `/posts/:id/comments` |

For detailed management (patterns/files/JSON editing), use the GUI (`/__snaperro__/client`).

### Web GUI

Intuitively operate snaperro from your browser.

<p align="center">
  <img src="https://raw.githubusercontent.com/yn1323/snaperro/main/gui-screenshot.png" alt="snaperro GUI" width="800" />
</p>

#### Access

```
http://localhost:3333/__snaperro__/client
```

The browser opens automatically when the server starts.

#### Features

| Feature | Description |
|---------|-------------|
| Mode Switch | Switch between Proxy/Record/Mock with one click |
| Pattern Management | Create, delete, duplicate, and rename patterns |
| File Management | List and delete recorded JSON files |
| JSON Editor | View and edit responses |
| Real-time Updates | Instantly reflect state changes via SSE |

### Configuration File

#### snaperro.config.ts

```typescript
import { defineConfig } from 'snaperro'

export default defineConfig({
  port: 3333,

  apis: {
    userService: {
      name: "User Service",
      target: "https://api.example.com",
      headers: {
        "X-Api-Key": process.env.API_KEY!,
      },
      routes: [
        "/api/users",
        "/api/users/:id",
        "/api/users/:id/profile",
      ],
    },

    orderService: {
      name: "Order Service",
      target: "https://order-api.example.com",
      routes: [
        "/api/orders",
        "/api/orders/:id",
        "/api/users/:userId/orders",
      ],
    },
  },
})
```

#### .env

```bash
# Sensitive information such as API keys
API_KEY=your-api-key-here
```

#### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `port` | number | Server port (default: 3333) |
| `filesDir` | string | File storage directory (default: `.snaperro/files`) |
| `mockFallback` | string | Fallback behavior when mock file is not found (default: `"404"`) |
| `apis` | object | API definitions object |

#### API Definition

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | string | Yes | API display name |
| `target` | string | Yes | Proxy target URL |
| `routes` | string[] | Yes | Matching route patterns |
| `headers` | object | No | Headers to add |
| `maskRequestHeaders` | string[] | No | Headers to mask when recording |

#### Upstream Proxy

If you're behind a corporate proxy, configure upstream proxy settings:

**Via config file:**

```typescript
export default defineConfig({
  upstreamProxy: {
    url: "http://proxy.company.com:8080",
  },
  // ...
})
```

**Via environment variable:**

```bash
export HTTPS_PROXY=http://proxy.company.com:8080
# or with authentication
export HTTPS_PROXY=http://username:password@proxy.company.com:8080
```

Config file takes priority over environment variables.

**Important:** When using an upstream proxy, add `localhost` to `NO_PROXY` to ensure local requests bypass the proxy:

```bash
export NO_PROXY=localhost,127.0.0.1
```

### CLI Commands

| Command | Description |
|---------|-------------|
| `npx snaperro init` | Initialize project |
| `npx snaperro start` | Start server |
| `npx snaperro start -p 4000` | Start with specified port |
| `npx snaperro demo` | Start demo environment |
| `npx snaperro postman` | Export Postman collection |

#### init Process

1. Create `.snaperro/` directory
2. Create `.snaperro/files/` directory
3. Create `snaperro.config.ts` template (if it doesn't exist)
4. Add `.snaperro/` to `.gitignore`

#### start Options

| Option | Description |
|--------|-------------|
| `-p, --port <port>` | Specify port number |
| `-c, --config <path>` | Specify config file path |
| `-e, --env <path>` | Specify env file path (default: `.env` in config directory) |
| `-v, --verbose` | Show detailed logs |

### 3 Modes

| Mode | Real API | Save JSON | Returns |
|------|----------|-----------|---------|
| **Proxy** | Access | No | Real response |
| **Record** | Access | Yes | Real response |
| **Mock** | No access | No | Saved JSON |

#### Proxy Mode

Connects to the actual API with headers (API Key, etc.) defined in the configuration file.

```
Request → snaperro → Real API → Response
```

#### Record Mode

Connects to the actual API while recording responses to JSON files.

```
Request → snaperro → Real API → Response
                ↓
           Save to JSON file
```

- Same endpoint, same parameters → Overwrite
- Same endpoint, different parameters → Create new file

#### Mock Mode

Returns responses from saved JSON files. Does not access the actual API.

```
Request → snaperro → Search JSON files → Response
```

#### Mock Fallback Behavior

When a mock file is not found, you can configure the fallback behavior with `mockFallback`:

| Value | Description |
|-------|-------------|
| `"404"` | Return 404 error (default) |
| `"proxy"` | Forward request to real server |
| `"proxy&record"` | Forward to real server and record the response |

```typescript
export default defineConfig({
  mockFallback: "proxy&record",  // Fallback to proxy and record
  // ...
})
```

### What is a Pattern?

A "pattern" is a folder that manages a set of mock data.

```
.snaperro/
├── state.json              ← Server state (mode, pattern)
└── files/
    ├── normal-full/           ← Pattern "normal-full"
    │   ├── api_users_001.json
    │   ├── api_users_{id}_001.json
    │   └── api_orders_001.json
    ├── empty-data/             ← Pattern "empty-data"
    │   └── api_users_001.json
    └── error-cases/             ← Pattern "error-cases"
        └── api_users_001.json
```

By switching patterns, you can use different mock data sets.
The previous mode and pattern are restored even after server restart.

### Route Definition and Matching

#### Path Parameters

Define path parameters with `:param` format.

```typescript
routes: [
  "/api/users",           // Exact match
  "/api/users/:id",       // :id is a parameter
  "/api/users/:id/orders/:orderId",  // Multiple parameters
]
```

#### Matching Examples

```typescript
routes: ["/api/users/:id"]
```

| Request | Match | pathParams |
|---------|-------|------------|
| `/api/users/123` | Yes | `{ id: "123" }` |
| `/api/users/abc` | Yes | `{ id: "abc" }` |
| `/api/users` | No | - |
| `/api/users/123/profile` | No | - |

#### Record Mode Behavior

- Same parameter request → Overwrite existing file
- New parameter request → Create new file

#### Mock Mode Behavior

- Return file with exact match of path parameters and query parameters
- Return 404 error if no matching file

### File Structure

```
your-project/
├── snaperro.config.ts     # Config file (Git managed)
├── .env                   # Sensitive info (Not Git managed)
├── .env.example           # Env template (Git managed)
└── .snaperro/             # Recorded data (Not Git managed)
    ├── state.json         # Server state
    └── files/
        ├── normal-full/
        │   ├── api_users_001.json
        │   └── api_users_{id}_001.json
        └── error-cases/
            └── api_users_001.json
```

### SSE (Server-Sent Events)

An SSE endpoint is provided for GUI and clients to detect state changes in real-time.

#### Endpoint

```
GET /__snaperro__/events
```

#### Verification

```bash
# curl
curl -N http://localhost:3333/__snaperro__/events

# Browser console
const es = new EventSource('http://localhost:3333/__snaperro__/events');
es.addEventListener('connected', (e) => console.log(JSON.parse(e.data)));
es.addEventListener('file_created', (e) => console.log(JSON.parse(e.data)));
```

#### Event Types

| Event | Description |
|-------|-------------|
| `connected` | Connection complete (includes initial state) |
| `mode_changed` | Mode changed |
| `pattern_changed` | Pattern switched |
| `file_created` | File created (during recording) |
| `file_updated` | File updated |
| `file_deleted` | File deleted |
| `pattern_created` | Pattern created |
| `pattern_deleted` | Pattern deleted |
| `pattern_renamed` | Pattern renamed |

---

## For Developers

### Local Development (Testing CLI without npm publish)

```bash
# 1. Install dependencies
pnpm install

# 2. Build
pnpm build

# 3. Run CLI locally
npx . init
npx . start
```

During development (run directly without build):

```bash
npx tsx src/cli/index.ts init
npx tsx src/cli/index.ts start
```

### Development Commands

**When you want to:**

| Goal | Command |
|------|---------|
| Watch code changes during development | `pnpm dev` |
| Build for production | `pnpm build` |
| Run tests | `pnpm test` |
| Run tests in watch mode | `pnpm test:watch` |
| Format code | `pnpm format` |
| Check type errors | `pnpm type-check` |
| Develop GUI | `pnpm dev:client` |
| Build GUI | `pnpm build:client` |
| Develop demo | `pnpm dev:demo` |
| Build demo | `pnpm build:demo` |

### Project Structure

```
snaperro/
├── cli/                      # CLI commands
│   ├── index.ts
│   └── commands/
│       ├── init.ts
│       ├── postman.ts
│       └── start.ts
├── server/                   # Hono server
│   ├── handlers/
│   │   ├── handler.ts
│   │   ├── proxy.ts
│   │   ├── recorder.ts
│   │   ├── mocker.ts
│   │   └── control-api.ts
│   ├── core/
│   │   ├── config.ts
│   │   ├── state.ts
│   │   ├── storage.ts
│   │   └── matcher.ts
│   └── types/
├── client/                   # React GUI
│   └── src/
├── demo/                     # Demo application
│   └── src/
└── doc/                      # Documentation
```

---

## Tech Stack

| Category | Choice |
|----------|--------|
| Server | Hono |
| CLI | Commander |
| GUI | React + Tailwind CSS |
| Schema | Zod |
| Logging | Consola |
| Path Matching | Picomatch |
| Build | tsup, Vite |
| Linter/Formatter | Biome |
| Test | Vitest |

## Requirements

- Node.js 18 or higher
- tsx must be installed (peerDependencies)

## License

MIT
