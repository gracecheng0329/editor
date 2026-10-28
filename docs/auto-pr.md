# 自動 PR 與 AI code review

每次 push 到 `main` 以外的分支，`.github/workflows/auto_pr.yml` 會：

1. 尋找該分支對 `main` 的開啟中 PR，解析關聯 issue。
2. 建立 PR 或更新既有 PR：標題完全採用 issue title，內文僅包含 `[issue title](issue URL)`。標題中的 Markdown 特殊字元會在連結文字中跳脫。
3. 使用 OpenAI 審查該次 push 的 diff 與 issue 規格，將結果以 `COMMENT` review 發布至 PR。審查不會批准或合併 PR，亦不代表已執行測試。

Issue 編號依序採用：手動執行 workflow 的 `issue_number`、既有 PR 的關聯 issue 或同 repo issue URL、分支編號、分支相對 `main` 的 commit 訊息中的 `#123`。分支格式例如 `issue-123/topic`、`codex/issue-123-topic`、`codex/123-topic`。同一來源有多個 issue，或找不到編號時，流程會失敗；可在 Actions 選擇對應分支並透過 Run workflow 輸入 `issue_number`。

PR 內文會被上述連結取代，額外說明請放在 issue。新格式沒有 `Closes #123`，合併 PR 不會因內文自動關閉 issue。

需要的設定：

- Repository secret `OPENAI`：OpenAI API key，沿用既有名稱。
- 選用 repository variable `AUTO_PR_REVIEW_MODEL`：預設沿用 `gpt-4o-mini`。
- 允許 Actions 建立 PR；或設定 `AUTO_PR_TOKEN`，需要 Contents / Issues read、Pull requests write。

審查在同一個 push workflow 執行，因此使用預設 `GITHUB_TOKEN` 建立 PR 時也能執行。流程只處理本 repo 分支的 push 與手動執行，不處理 fork PR 事件。同一個 commit 已有帶識別標記的 review 時會跳過；PR 已關閉或有更新的 push 時也會跳過。超過 60,000 字元的 diff 僅提供前段，review 會標示範圍。缺少 key、API 失敗或回覆不完整時，PR metadata 已可完成更新，但 review step 會失敗，不會張貼成功審查訊息。

本機離線驗證：

```sh
python3 -m unittest discover -s scripts -p 'test_auto_pr.py'
```

API 格式參考：[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。
