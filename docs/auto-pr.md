# 自動 PR 與 AI code review

每次 push 到 `main` 以外的分支，`.github/workflows/auto_pr.yml` 會：

1. 尋找該分支對 `main` 的開啟中 PR，解析關聯 issue。
2. 建立 PR 或更新既有 PR：標題完全採用 issue title；讀取 `.agents/skills/pr/SKILL.md`，以 issue、diff 與檔案統計產生 `Summary`、`Evidence`、`Merge Danger` 內文。Summary 附 issue 連結及簡短變更圖；Evidence 使用 Before／After；Merge Danger 包含 Door 與 Blast Radius。
3. 使用 OpenAI 審查該次 push 的 diff 與 issue 規格，將結果以 `COMMENT` review 發布至 PR。審查不會批准或合併 PR，亦不代表已執行測試。

Issue 編號依序採用：手動執行 workflow 的 `issue_number`、內文的 `auto-pr-issue` 主 issue 標記、既有 PR 的關聯 issue 或同 repo issue URL、分支編號、分支相對 `main` 的 commit 訊息中的 `#123`。主 issue 標記可避免 Summary 引用相關票券時被誤判為多個主 issue。分支格式例如 `issue-123/topic`、`codex/issue-123-topic`、`codex/123-topic`。同一來源有多個 issue，或找不到編號時，流程會失敗；可在 Actions 選擇對應分支並透過 Run workflow 輸入 `issue_number`。

自動產生的內文帶 `auto-pr-body` 標記，每次 push 會更新。人工撰寫且已符合 skill 完整欄位的內文會保留，避免覆蓋已驗證證據；若要改為人工維護已產生的內文，移除 `auto-pr-body` 標記即可。`auto-pr-issue` 標記只記錄主 issue，不是關閉指令。

缺少 key、API 失敗或回傳格式不符時，仍會產生相同章節的 Git 統計模板；測試與風險未知處明確標為未驗證／待人工評估。此 workflow 只驗證自動 PR 腳本，沒有執行產品測試、lint、build 或部署，不能推論產品驗收通過。

需要的設定：

- Repository secret `OPENAI`：OpenAI API key，沿用既有名稱。
- 選用 repository variables `AUTO_PR_BODY_MODEL`／`AUTO_PR_REVIEW_MODEL`：分別用於內文與審查，預設沿用 `gpt-4o-mini`。
- 允許 Actions 建立 PR；或設定 `AUTO_PR_TOKEN`，需要 Contents / Issues read、Pull requests write。

審查在同一個 push workflow 執行，因此使用預設 `GITHUB_TOKEN` 建立 PR 時也能執行。流程只處理本 repo 分支的 push 與手動執行，不處理 fork PR 事件。同一個 commit 已有帶識別標記的 review 時會跳過；PR 已關閉或有更新的 push 時也會跳過。超過 60,000 字元的 diff 僅提供前段，review 會標示範圍。缺少 key、API 失敗或回覆不完整時，PR metadata 已可完成更新，但 review step 會失敗，不會張貼成功審查訊息。

本機離線驗證：

```sh
python3 -m unittest discover -s scripts -p 'test_auto_pr.py'
```

API 格式參考：[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。
