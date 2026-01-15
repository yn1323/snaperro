# SSE（Server-Sent Events）

## 概要

snaperroはSSEを使用してサーバーからクライアントへリアルタイムに状態変更を通知します。
GUIの自動更新やリクエストログの表示に使用されます。

## 関連ファイル

- **Server**: `server/core/event-bus.ts`, `server/handlers/control-api.ts`
- **Client**: `client/src/hooks/useSnaperroSSE.ts`
- **Types**: `shared/types/sse.ts`

---

## エンドポイント

```
GET /__snaperro__/events
```

**Content-Type**: `text/event-stream`

---

## イベント一覧

| イベント | 説明 | データ |
|---------|------|--------|
| `connected` | 接続完了（初期状態送信） | `ConnectedEventData` |
| `mode_changed` | モード変更 | `ModeChangedEventData` |
| `scenario_changed` | シナリオ切り替え | `ScenarioChangedEventData` |
| `scenario_created` | シナリオ作成 | `ScenarioCreatedEventData` |
| `scenario_deleted` | シナリオ削除 | `ScenarioDeletedEventData` |
| `scenario_renamed` | シナリオリネーム | `ScenarioRenamedEventData` |
| `folder_created` | フォルダ作成 | `FolderCreatedEventData` |
| `folder_deleted` | フォルダ削除 | `FolderDeletedEventData` |
| `folder_renamed` | フォルダリネーム | `FolderRenamedEventData` |
| `file_created` | ファイル作成 | `FileChangedEventData` |
| `file_updated` | ファイル更新 | `FileChangedEventData` |
| `file_deleted` | ファイル削除 | `FileDeletedEventData` |
| `request_log` | リクエストログ | `RequestLogEventData` |

---

## イベントデータ型

### ConnectedEventData
```typescript
{
  version: string;
  mode: "proxy" | "record" | "mock" | "smart";
  currentScenario: string | null;
  scenarios: string[];
  folders: FolderInfo[];
  files: FileInfo[];
}
```

### ModeChangedEventData
```typescript
{
  mode: "proxy" | "record" | "mock" | "smart";
}
```

### ScenarioChangedEventData
```typescript
{
  scenario: string | null;
  files: FileInfo[];
}
```

### FileChangedEventData
```typescript
{
  scenario: string;
  filename: string;
  endpoint: string;
  method: string;
}
```

### RequestLogEventData
```typescript
{
  id: string;
  timestamp: string;
  method: string;
  path: string;
  action: "proxy" | "record" | "mock" | "smart";
  subAction?: "mock" | "record";
  status: number;
  filePath?: string;
  duration: number;
}
```

---

## SSEメッセージ形式

```
event: connected
data: {"version":"1.0.0","mode":"smart","currentScenario":"demo",...}

event: mode_changed
data: {"mode":"record"}

event: file_created
data: {"scenario":"demo","filename":"api_users_001.json","endpoint":"/api/users","method":"GET"}
```

---

## Keep-Alive

30秒ごとにコメント（`: keep-alive`）を送信し、接続を維持します。

---

## クライアント実装

### useSnaperroSSE フック

```typescript
// client/src/hooks/useSnaperroSSE.ts

const {
  isConnected,
  mode,
  currentScenario,
  scenarios,
  files,
  requestLogs
} = useSnaperroSSE();
```

**機能**:
- 自動接続・再接続（3秒後にリトライ）
- イベント受信時に状態更新
- 接続状態の管理

### 使用例

```typescript
function App() {
  const { isConnected, mode, files } = useSnaperroSSE();

  if (!isConnected) {
    return <div>Connecting...</div>;
  }

  return (
    <div>
      <p>Mode: {mode}</p>
      <ul>
        {files.map(f => <li key={f.filename}>{f.filename}</li>)}
      </ul>
    </div>
  );
}
```

---

## サーバー実装

### EventBus

```typescript
// server/core/event-bus.ts

// イベント発火
eventBus.emit('file_created', {
  scenario: 'demo',
  filename: 'api_users_001.json',
  endpoint: '/api/users',
  method: 'GET'
});

// SSEストリームへの接続
eventBus.subscribe(stream);
```

### Control APIでのSSEエンドポイント

```typescript
// server/handlers/control-api.ts

app.get('/events', (c) => {
  return streamSSE(c, async (stream) => {
    // 初期状態を送信
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify(initialState)
    });

    // イベント購読
    eventBus.subscribe(stream);
  });
});
```

---

## イベント発火タイミング

| 操作 | 発火イベント |
|------|-------------|
| モード変更 | `mode_changed` |
| シナリオ選択 | `scenario_changed` |
| シナリオ作成 | `scenario_created` |
| シナリオ削除 | `scenario_deleted` |
| シナリオリネーム | `scenario_renamed` |
| Recordモードでリクエスト | `file_created` + `request_log` |
| ファイル編集保存 | `file_updated` |
| ファイル削除 | `file_deleted` |
| 全リクエスト（全モード） | `request_log` |

---

## エラーハンドリング

### 接続断時
クライアントは3秒後に自動再接続を試みます。

### 再接続時
`connected` イベントで最新の全状態が送信されるため、
クライアントは差分ではなく完全な状態を受け取ります。

---

## 関連ドキュメント

- [gui.md](gui.md) - GUIでのリアルタイム更新
- [control-api.md](control-api.md) - SSEエンドポイント
