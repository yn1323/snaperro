/**
 * Postman コレクション出力コマンド
 * snaperro の内部制御APIをPostman形式で出力する
 */

const POSTMAN_COLLECTION = {
  info: {
    _postman_id: "snaperro-api-collection",
    name: "snaperro API Collection",
    description: "snaperro - GUI付きモックプロキシサーバーの内部制御API",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  variable: [
    {
      key: "baseUrl",
      value: "http://localhost:3333",
      type: "string",
    },
  ],
  item: [
    {
      name: "Status",
      item: [
        {
          name: "Get Server Status",
          request: {
            method: "GET",
            header: [],
            url: {
              raw: "{{baseUrl}}/__snaperro__/status",
              host: ["{{baseUrl}}"],
              path: ["__snaperro__", "status"],
            },
            description: "サーバーステータス取得（モード、パターン、レコーディング数）",
          },
        },
        {
          name: "Get Current Mode",
          request: {
            method: "GET",
            header: [],
            url: {
              raw: "{{baseUrl}}/__snaperro__/mode",
              host: ["{{baseUrl}}"],
              path: ["__snaperro__", "mode"],
            },
            description: "現在のモード取得 (proxy/record/mock)",
          },
        },
        {
          name: "Change Mode",
          request: {
            method: "PUT",
            header: [{ key: "Content-Type", value: "application/json" }],
            body: {
              mode: "raw",
              raw: '{\n  "mode": "mock"\n}',
              options: { raw: { language: "json" } },
            },
            url: {
              raw: "{{baseUrl}}/__snaperro__/mode",
              host: ["{{baseUrl}}"],
              path: ["__snaperro__", "mode"],
            },
            description: "モード変更 (proxy/record/mock)",
          },
        },
      ],
    },
    {
      name: "Patterns",
      item: [
        {
          name: "List All Patterns",
          request: {
            method: "GET",
            header: [],
            url: {
              raw: "{{baseUrl}}/__snaperro__/patterns",
              host: ["{{baseUrl}}"],
              path: ["__snaperro__", "patterns"],
            },
            description: "パターン一覧取得",
          },
        },
        {
          name: "Get Current Pattern",
          request: {
            method: "GET",
            header: [],
            url: {
              raw: "{{baseUrl}}/__snaperro__/patterns/current",
              host: ["{{baseUrl}}"],
              path: ["__snaperro__", "patterns", "current"],
            },
            description: "現在選択中のパターン取得",
          },
        },
        {
          name: "Switch Pattern",
          request: {
            method: "PUT",
            header: [{ key: "Content-Type", value: "application/json" }],
            body: {
              mode: "raw",
              raw: '{\n  "pattern": "demo"\n}',
              options: { raw: { language: "json" } },
            },
            url: {
              raw: "{{baseUrl}}/__snaperro__/patterns/current",
              host: ["{{baseUrl}}"],
              path: ["__snaperro__", "patterns", "current"],
            },
            description: "パターン切替",
          },
        },
        {
          name: "Create Pattern",
          request: {
            method: "POST",
            header: [{ key: "Content-Type", value: "application/json" }],
            body: {
              mode: "raw",
              raw: '{\n  "name": "新規パターン"\n}',
              options: { raw: { language: "json" } },
            },
            url: {
              raw: "{{baseUrl}}/__snaperro__/patterns",
              host: ["{{baseUrl}}"],
              path: ["__snaperro__", "patterns"],
            },
            description: "新規パターン作成",
          },
        },
        {
          name: "Duplicate Pattern",
          request: {
            method: "POST",
            header: [{ key: "Content-Type", value: "application/json" }],
            body: {
              mode: "raw",
              raw: '{\n  "newName": "demo_copy"\n}',
              options: { raw: { language: "json" } },
            },
            url: {
              raw: "{{baseUrl}}/__snaperro__/patterns/:name/duplicate",
              host: ["{{baseUrl}}"],
              path: ["__snaperro__", "patterns", ":name", "duplicate"],
              variable: [{ key: "name", value: "demo", description: "複製元のパターン名" }],
            },
            description: "既存パターンを複製",
          },
        },
        {
          name: "Rename Pattern",
          request: {
            method: "PUT",
            header: [{ key: "Content-Type", value: "application/json" }],
            body: {
              mode: "raw",
              raw: '{\n  "newName": "新しいパターン名"\n}',
              options: { raw: { language: "json" } },
            },
            url: {
              raw: "{{baseUrl}}/__snaperro__/patterns/:name/rename",
              host: ["{{baseUrl}}"],
              path: ["__snaperro__", "patterns", ":name", "rename"],
              variable: [{ key: "name", value: "demo", description: "変更前のパターン名" }],
            },
            description: "パターン名変更",
          },
        },
        {
          name: "Delete Pattern",
          request: {
            method: "DELETE",
            header: [],
            url: {
              raw: "{{baseUrl}}/__snaperro__/patterns/:name",
              host: ["{{baseUrl}}"],
              path: ["__snaperro__", "patterns", ":name"],
              variable: [{ key: "name", value: "削除するパターン", description: "削除するパターン名" }],
            },
            description: "パターン削除",
          },
        },
        {
          name: "Download Pattern as ZIP",
          request: {
            method: "GET",
            header: [],
            url: {
              raw: "{{baseUrl}}/__snaperro__/patterns/:name/download",
              host: ["{{baseUrl}}"],
              path: ["__snaperro__", "patterns", ":name", "download"],
              variable: [{ key: "name", value: "demo", description: "ダウンロードするパターン名" }],
            },
            description: "パターンをZIP形式でダウンロード",
          },
        },
        {
          name: "Upload Pattern from ZIP",
          request: {
            method: "POST",
            header: [],
            body: {
              mode: "formdata",
              formdata: [{ key: "file", type: "file", src: "", description: "アップロードするZIPファイル" }],
            },
            url: {
              raw: "{{baseUrl}}/__snaperro__/patterns/upload",
              host: ["{{baseUrl}}"],
              path: ["__snaperro__", "patterns", "upload"],
            },
            description: "ZIPファイルからパターンをアップロード",
          },
        },
      ],
    },
    {
      name: "Recordings",
      description: "RESTful: パターンをURLに含める",
      item: [
        {
          name: "List All Recordings",
          request: {
            method: "GET",
            header: [],
            url: {
              raw: "{{baseUrl}}/__snaperro__/patterns/:pattern/recordings",
              host: ["{{baseUrl}}"],
              path: ["__snaperro__", "patterns", ":pattern", "recordings"],
              variable: [{ key: "pattern", value: "demo", description: "パターン名" }],
            },
            description: "指定パターン内のレコーディング一覧取得",
          },
        },
        {
          name: "Get Recording Content",
          request: {
            method: "GET",
            header: [],
            url: {
              raw: "{{baseUrl}}/__snaperro__/patterns/:pattern/recordings/:filename",
              host: ["{{baseUrl}}"],
              path: ["__snaperro__", "patterns", ":pattern", "recordings", ":filename"],
              variable: [
                { key: "pattern", value: "demo", description: "パターン名" },
                { key: "filename", value: "users_001.json", description: "レコーディングファイル名" },
              ],
            },
            description: "レコーディング内容取得",
          },
        },
        {
          name: "Download Recording",
          request: {
            method: "GET",
            header: [],
            url: {
              raw: "{{baseUrl}}/__snaperro__/patterns/:pattern/recordings/:filename/download",
              host: ["{{baseUrl}}"],
              path: ["__snaperro__", "patterns", ":pattern", "recordings", ":filename", "download"],
              variable: [
                { key: "pattern", value: "demo", description: "パターン名" },
                { key: "filename", value: "users_001.json", description: "ダウンロードするファイル名" },
              ],
            },
            description: "レコーディングファイルをダウンロード",
          },
        },
        {
          name: "Upload Recording",
          request: {
            method: "POST",
            header: [],
            body: {
              mode: "formdata",
              formdata: [{ key: "file", type: "file", src: "", description: "アップロードするJSONファイル" }],
            },
            url: {
              raw: "{{baseUrl}}/__snaperro__/patterns/:pattern/recordings/upload",
              host: ["{{baseUrl}}"],
              path: ["__snaperro__", "patterns", ":pattern", "recordings", "upload"],
              variable: [{ key: "pattern", value: "demo", description: "パターン名" }],
            },
            description: "レコーディングJSONファイルをアップロード",
          },
        },
        {
          name: "Edit Recording",
          request: {
            method: "PUT",
            header: [{ key: "Content-Type", value: "application/json" }],
            body: {
              mode: "raw",
              raw: '{\n  "endpoint": "/api/users/:id",\n  "method": "GET",\n  "request": {\n    "pathParams": { "id": "123" },\n    "queryParams": {},\n    "headers": {},\n    "body": null\n  },\n  "response": {\n    "status": 200,\n    "headers": { "Content-Type": "application/json" },\n    "body": {\n      "id": 123,\n      "name": "Updated User"\n    }\n  }\n}',
              options: { raw: { language: "json" } },
            },
            url: {
              raw: "{{baseUrl}}/__snaperro__/patterns/:pattern/recordings/:filename",
              host: ["{{baseUrl}}"],
              path: ["__snaperro__", "patterns", ":pattern", "recordings", ":filename"],
              variable: [
                { key: "pattern", value: "demo", description: "パターン名" },
                { key: "filename", value: "users_001.json", description: "編集するファイル名" },
              ],
            },
            description: "レコーディング内容を編集",
          },
        },
        {
          name: "Delete Recording",
          request: {
            method: "DELETE",
            header: [],
            url: {
              raw: "{{baseUrl}}/__snaperro__/patterns/:pattern/recordings/:filename",
              host: ["{{baseUrl}}"],
              path: ["__snaperro__", "patterns", ":pattern", "recordings", ":filename"],
              variable: [
                { key: "pattern", value: "demo", description: "パターン名" },
                { key: "filename", value: "users_001.json", description: "削除するファイル名" },
              ],
            },
            description: "レコーディング削除",
          },
        },
      ],
    },
  ],
};

/**
 * postman コマンド
 * Postmanコレクションを標準出力にJSON形式で出力
 */
export async function postmanCommand(): Promise<void> {
  console.log(JSON.stringify(POSTMAN_COLLECTION, null, 2));
}
