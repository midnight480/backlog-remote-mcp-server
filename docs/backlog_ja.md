# Backlog の API キーとスペース設定

対象: Cloudflare / AWS 共通

Backlog のスペースごとに API キーを発行し、`BACKLOG_SPACES_CONFIG` を組み立てます。
複数スペースを 1 つのサーバから扱えます。

接続したい各BacklogスペースごとにAPIキーが必要です。

## 手順

1. Backlogスペースにログイン (例: `https://your-space.backlog.com`)
2. 右上のアバターをクリック → **個人設定**
3. **API** タブを開く
4. **新しいアプリケーションの登録** をクリック (またはプランにより **APIキーの発行**)
5. メモを入力 (例: `MCP Server`) → **登録**
6. 生成されたAPIキーをコピー

## 複数スペースがある場合

各スペースで同じ手順を繰り返し、以下のJSON形式で `BACKLOG_SPACES_CONFIG` を構成します:

```json
{
  "spaces": [
    {
      "name": "WORK",
      "domain": "your-company.backlog.com",
      "apiKey": "仕事用スペースのAPIキー"
    },
    {
      "name": "SHARED",
      "domain": "shared.backlog.jp",
      "apiKey": "共用スペースのAPIキー",
      "readOnly": true
    }
  ],
  "defaultSpace": "WORK"
}
```

| フィールド | 必須 | 説明 |
|-----------|:---:|------|
| `name` | ✅ | 任意のラベル。MCPツール呼び出し時の `space` パラメータとして使用。大文字小文字は区別されません |
| `domain` | ✅ | Backlogスペースのドメイン (例: `your-space.backlog.com` または `your-space.backlog.jp`)。スキームは含めません |
| `apiKey` | ✅ | 上記で生成したAPIキー |
| `readOnly` | | `true` で **GET以外のAPI呼び出しを拒否**。共用スペースの誤更新・誤削除を防ぎます |
| `defaultSpace` | ✅ | `space` パラメータ省略時に使用するスペース。`spaces` 内の `name` と一致させること |

この値は `.dev.vars` に1行のJSONとして設定します。

```
BACKLOG_SPACES_CONFIG={"spaces":[{"name":"WORK","domain":"your-company.backlog.com","apiKey":"xxx"},{"name":"SHARED","domain":"shared.backlog.jp","apiKey":"yyy","readOnly":true}],"defaultSpace":"WORK"}
```

## readOnly の使いどころ

MCPツールには `add_issue` / `update_issue` / `delete_issue` / `delete_project` といった破壊的操作が含まれ、呼び出す主体はLLMです。曖昧な指示が意図しないスペースに向いた場合、`readOnly: true` が最後の歯止めになります。

判定は `src/core/backlog-client.ts` のAPI呼び出し層で行われるため、個々のツール実装に依存せず、将来ツールが追加されても自動的に保護されます。拒否された場合はBacklog APIへリクエストを送る前にエラーが返ります。

```
Space "SHARED" is configured as read-only. Refusing POST /issues.
Use list_spaces to see which spaces allow writes.
```

各スペースの状態は `list_spaces` ツールで確認できます。

## 注意事項

- APIキーは、キー所有者の権限でBacklogスペースへのフルアクセスを許可します。`readOnly: true` はこのMCPサーバー内のガードであり、キー自体の権限を制限するものではありません
- 書き込みが不要なスペースには、Backlog側で権限を絞ったキーを発行し、あわせて `readOnly: true` を設定するのが確実です
- キーは機密情報です。Cloudflare Secretsに格納され、MCPクライアントには一切露出しません
- キーが漏洩した場合は、Backlogの個人設定 → API から即座に無効化してください

---

---

- 次: [Google Cloud を IdP にする](idp-google_ja.md) / [Microsoft Entra ID を IdP にする](idp-entra-id_ja.md)
- デプロイ: [Cloudflare Workers 版](deploy-cloudflare_ja.md) / [AWS 版](deploy-aws_ja.md)
