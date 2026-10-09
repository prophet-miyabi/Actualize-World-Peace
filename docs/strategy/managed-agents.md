# AI企業の実行基盤: Claude Platform（Managed Agents）

2026-10-10 から、AI企業のエージェントは Claude Platform の Managed Agents 上で動く。

## 役割分担
| 層 | 担当 | 中身 |
|---|---|---|
| 制御（Control plane） | AWP（backend/src/company） | 目標・KPI、タスクの作成と順序、権限（リスク上限）、人間の承認、メモリ（DB）、予算、監査、Discord 通知、管理画面 |
| 実行（Execution plane） | Claude Platform | エージェント定義の版管理、会話ループ、文脈の圧縮、プロンプトキャッシュ、セッション予算の強制、Console での追跡 |
| 道具（Tools） | AWP（カスタムツール） | 指標・費用・台帳・メモリ・タスク作成・報告など24種。Platform から `agent.custom_tool_use` で呼ばれ、AWP が実行して結果を返す |

## 流れ（1タスク）
1. ループ（`loop.ts`）がタスクを拾い `runTask` を呼ぶ
2. `ensureManagedAgent`: 定義（役割・決まり・道具・モデル）のハッシュが前回と違えば Platform に新しい版を作る
3. セッション作成（予算 = その日の残り予算と月の残りの小さい方）→ ストリームを開く → 最初のメッセージ（タスク + 状況）
4. 道具が呼ばれるたびに AWP が実行（権限超過なら `CompanyAction` を作って承認待ち）
5. `finish_task` で報告 → `AgentRun` に費用（Platform の list_cost）とセッションIDを記録 → 監査へ
6. セッションはアーカイブ（Console で読める）

## 切り替えと退路
- `COMPANY_ENGINE=managed`（既定）/ `messages`（自前ループ）
- 同期やセッション作成に失敗した場合はそのタスクだけ自前ループで実行（イベント `agent.engine_fallback`）

## 次の拡張（Platform の機能で可能になるもの）
- **マルチエージェント**: COO をコーディネータにして専門職をロスター化（1セッション内で並列）
- **メモリストア**: 会社メモリを Platform のメモリストアへ（版管理・編集履歴つき）
- **スケジュール実行**: CEO 日次・週次をデプロイメント（cron）に。Webhook で AWP が結果を受け取る
- **MCP / Vault**: GitHub・Discord・解析ツールを MCP で接続し、資格情報は Vault に
- **Outcomes**: 成果物タスク（レポート・計画書）をルーブリック採点で自動反復
