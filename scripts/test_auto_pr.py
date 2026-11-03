"""Offline regression tests: python3 -m unittest discover -s scripts -p 'test_auto_pr.py'."""

from contextlib import ExitStack
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock
import urllib.error

import auto_pr


class AutoPRTests(unittest.TestCase):
    def setUp(self):
        self.contexts = ExitStack()
        self.addCleanup(self.contexts.close)
        self.contexts.enter_context(patch.dict(os.environ, {"OPENAI_API_KEY": "", "GH_REPO": self.repo}))

    repo = "owner/repo"
    issue = {"number": 42, "title": "新增 [文件] 權限", "body": "spec",
             "url": "https://github.com/owner/repo/issues/42"}

    def test_branch_references_and_commit_fallback(self):
        for branch in ("codex/42-permissions", "issue-42/topic", "codex/issue-42-permissions"):
            self.assertEqual(auto_pr.issue_number(branch, "Refs #99", None, self.repo), 42)
        self.assertEqual(auto_pr.issue_number("codex/topic", "Closes #42", None, self.repo), 42)

    def test_existing_link_takes_priority(self):
        pr = {"body": f"[issue]({self.issue['url']})"}
        self.assertEqual(auto_pr.issue_number("issue-99/topic", "", pr, self.repo), 42)

    def test_external_issue_does_not_match(self):
        pr = {"body": "https://github.com/other/repo/issues/88"}
        self.assertEqual(auto_pr.issue_number("issue-42/topic", "", pr, self.repo), 42)

    def test_missing_or_ambiguous_reference_requires_explicit_choice(self):
        for commits in ("no reference", "Refs #42 and #43"):
            with self.assertRaises(ValueError):
                auto_pr.issue_number("codex/topic", commits, None, self.repo)
        self.assertEqual(auto_pr.issue_number("codex/topic", "Refs #42 and #43", None, self.repo, "43"), 43)

    def test_content_uses_issue_title_and_pr_skill_template_without_api_key(self):
        title, body = auto_pr.pr_content(self.issue)
        self.assertEqual(title, self.issue["title"])
        self.assertIn(r"[新增 \[文件\] 權限](https://github.com/owner/repo/issues/42)", body)
        for section in ("## Summary", "## Evidence", "## Merge Danger", "**Before:**", "**After:**", "**Door:**", "**Blast Radius:**"):
            self.assertIn(section, body)
        self.assertIn("未執行", body)

    template = "## Summary\n\n```diff\n+ private documents\n```\n\n## Evidence\n\n- **Before:** unavailable\n  **After:** unverified\n\n## Merge Danger\n\n**Door:** two-way\n\n**Blast Radius:** documents"

    def response(self, content):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({
            "choices": [{"message": {"content": content}, "finish_reason": "stop"}]
        }).encode()
        return response

    def test_primary_issue_marker_allows_related_issue_links(self):
        pr = {"body": "<!-- auto-pr-issue: owner/repo#42 -->\nhttps://github.com/owner/repo/issues/42\nhttps://github.com/owner/repo/issues/43"}
        self.assertEqual(auto_pr.issue_number("topic", "", pr, self.repo), 42)

    def test_handwritten_skill_body_keeps_verified_evidence(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}), patch.object(auto_pr.urllib.request, "urlopen") as api:
            _, body = auto_pr.pr_content(self.issue, existing_body=self.template)
        self.assertIn(self.template.split("## Evidence")[1], body)
        self.assertNotIn(auto_pr.BODY_MARKER, body)
        api.assert_not_called()

    def test_api_body_receives_skill_and_truncated_diff(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}), patch.object(
            auto_pr.urllib.request, "urlopen", return_value=self.response(self.template)
        ) as api:
            _, body = auto_pr.pr_content(self.issue, diff="x" * (auto_pr.DIFF_LIMIT + 1))
        payload = json.loads(api.call_args.args[0].data)
        self.assertIn("Use this template for writing the PR body", payload["messages"][0]["content"])
        self.assertTrue(json.loads(payload["messages"][1]["content"])["truncated"])
        self.assertIn("文件", json.loads(payload["messages"][1]["content"])["glossary"])
        self.assertIn("描述依據截斷", body)
        self.assertIn(auto_pr.BODY_MARKER, body)

    def test_body_api_error_or_invalid_template_uses_truthful_fallback(self):
        for output in (self.response("invalid body"), urllib.error.HTTPError("url", 429, "private-response", {}, None), ConnectionResetError("private-response")):
            with self.subTest(output=type(output).__name__), patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}), patch.object(
                auto_pr.urllib.request, "urlopen", **({"side_effect": output} if isinstance(output, Exception) else {"return_value": output})
            ):
                _, body = auto_pr.pr_content(self.issue, stat="1 file changed")
                self.assertIn("## Summary", body)
                self.assertIn("1 file changed", body)
                self.assertIn("未執行產品測試", body)
                self.assertNotIn("private-response", body)

    def test_sync_updates_existing_pr_without_openai(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "RUNNER_TEMP": directory, "GH_REPO": self.repo, "HEAD_BRANCH": "issue-42/topic",
            "BASE_BRANCH": "main", "ISSUE_NUMBER": "",
        }), patch.object(auto_pr, "gh_json", side_effect=[
            [{"number": 7, "body": ""}], self.issue, {},
        ]) as gh, patch.object(auto_pr, "run", side_effect=["app/page.tsx", "Closes #42", "diff", ""]):
            auto_pr.sync()
            self.assertEqual(gh.call_args.kwargs["payload"], dict(zip(("title", "body"), auto_pr.pr_content(self.issue))))

    def test_sync_creates_pr_with_body_file(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "RUNNER_TEMP": directory, "GH_REPO": self.repo, "HEAD_BRANCH": "issue-42/topic",
            "BASE_BRANCH": "main", "ISSUE_NUMBER": "",
        }), patch.object(auto_pr, "gh_json", side_effect=[[], self.issue, {"number": 7}]), patch.object(
            auto_pr, "run", side_effect=["app/page.tsx", "Closes #42", "diff", "", "https://github.com/owner/repo/pull/7\n"]
        ) as run:
            auto_pr.sync()
            args = run.call_args.args
            self.assertIn("--body-file", args)
            self.assertEqual(Path(args[-1]).read_text(), auto_pr.pr_content(self.issue)[1])

    def test_empty_diff_does_not_create_pr(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "RUNNER_TEMP": directory, "GH_REPO": self.repo,
            "HEAD_BRANCH": "topic", "BASE_BRANCH": "main",
        }), patch.object(auto_pr, "gh_json", return_value=[]) as gh, patch.object(
            auto_pr, "run", return_value=""
        ):
            auto_pr.sync()
            self.assertEqual(gh.call_count, 1)

    def test_incomplete_model_output_is_rejected(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({
            "choices": [{"message": {"content": "partial"}, "finish_reason": "length"}]
        }).encode()
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}), patch.object(
            auto_pr.urllib.request, "urlopen", return_value=response
        ):
            with self.assertRaisesRegex(ValueError, "incomplete"):
                auto_pr.completion([])

    def test_http_error_does_not_expose_response_or_key(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}), patch.object(
            auto_pr.urllib.request, "urlopen",
            side_effect=urllib.error.HTTPError("url", 429, "secret-response", {}, None),
        ):
            with self.assertRaisesRegex(ValueError, "^OpenAI API returned HTTP 429$"):
                auto_pr.completion([])



if __name__ == "__main__":
    unittest.main()
