# PR 前 Standards／Spec 審查與自動 PR

## 本機審查先行

建立 PR 或 push 會建立／更新 PR 的分支前，由 Codex 執行 `.agents/skills/code-review/SKILL.md`。這是 agent 工作流程要求；Actions 不會驗證本機審查是否完成，也不會自動執行這兩軸審查。

1. 固定目標分支的 merge-base 與待審提交，確認 diff 非空；列出本輪 commits。
2. 依 code-review skill 平行執行兩個獨立審查：**Standards** 對照 repo 規範與 skill 的 smell baseline；**Spec** 對照關聯 GitHub issue／規格。缺少規格時明確記錄未審查，不能視為通過。
3. 修正可處理的問題，重跑受影響測試並複查變更；分別保留兩軸結果。審查不代替測試、型別、lint、build 或部署驗證。
4. 依 `pr` skill 撰寫內文，在 Evidence 記錄審查的 base/head、兩軸發現及修正、測試證據與未完成驗證，再建立 PR 或 push。後續新增變更也先審查再 push。

本機審查由 Codex 使用現有工作階段與子代理完成，不使用此 repo 的 OpenAI API key。審查結果記錄在 PR 內文，不再由 Actions 張貼 AI review。

## Actions 的範圍

每次 push 到 `main` 以外的分支，`.github/workflows/auto_pr.yml` 只驗證自動化腳本並建立／同步 PR：標題完全採用 issue title；依 `.agents/skills/pr/SKILL.md` 產生 `Summary`、`Evidence`、`Merge Danger` 內文。Summary 附 issue 連結及簡短變更圖；Evidence 使用 Before／After；Merge Danger 包含 Door 與 Blast Radius。

Issue 編號依序採用：手動執行 workflow 的 `issue_number`、內文的 `auto-pr-issue` 主 issue 標記、既有 PR 的關聯 issue 或同 repo issue URL、分支編號、分支相對 `main` 的 commit 訊息中的 `#123`。主 issue 標記可避免相關票券連結造成歧義。分支格式例如 `issue-123/topic`、`codex/issue-123-topic`、`codex/123-topic`。找不到編號或同一來源有多個 issue 時，流程會失敗；可手動執行 workflow 指定 `issue_number`。

自動產生的內文帶 `auto-pr-body` 標記，每次 push 更新。人工撰寫且符合 skill 完整欄位的內文會保留，避免覆蓋本機審查與測試證據；人工維護時移除 `auto-pr-body` 標記。`auto-pr-issue` 僅記錄主 issue，不是關閉指令。

PR 內文仍可選用 OpenAI 產生；缺少 key、API 失敗或格式不符時，改用相同章節的 Git 統計模板，證據與風險標為未驗證／待人工評估。這不是程式碼審查。Actions 不執行產品測試、lint、build 或部署。

設定：

- 允許 Actions 建立 PR；或設定 `AUTO_PR_TOKEN`，需要 Contents／Issues read、Pull requests write。
- 選用 secret `OPENAI` 與 variable `AUTO_PR_BODY_MODEL`：僅用於 PR 內文，模型預設 `gpt-4o-mini`。不再使用 `AUTO_PR_REVIEW_MODEL`。

本機離線驗證：

```sh
python3 -m unittest discover -s scripts -p 'test_auto_pr.py'
```
