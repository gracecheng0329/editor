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

    def test_content_uses_exact_issue_title_and_escaped_link(self):
        title, body = auto_pr.pr_content(self.issue)
        self.assertEqual(title, self.issue["title"])
        self.assertEqual(body, r"[新增 \[文件\] 權限](https://github.com/owner/repo/issues/42)")

    def test_sync_updates_existing_pr_without_openai(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "RUNNER_TEMP": directory, "GH_REPO": self.repo, "HEAD_BRANCH": "issue-42/topic",
            "BASE_BRANCH": "main", "ISSUE_NUMBER": "",
        }), patch.object(auto_pr, "gh_json", side_effect=[
            [{"number": 7, "body": ""}], self.issue, {},
        ]) as gh, patch.object(auto_pr, "run", side_effect=["app/page.tsx", "Closes #42"]):
            auto_pr.sync()
            self.assertEqual(gh.call_args.kwargs["payload"], dict(zip(("title", "body"), auto_pr.pr_content(self.issue))))
            self.assertEqual(json.loads(auto_pr.context_path().read_text())["pr"], 7)

    def test_sync_creates_pr_with_body_file(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "RUNNER_TEMP": directory, "GH_REPO": self.repo, "HEAD_BRANCH": "issue-42/topic",
            "BASE_BRANCH": "main", "ISSUE_NUMBER": "",
        }), patch.object(auto_pr, "gh_json", side_effect=[[], self.issue, {"number": 7}]), patch.object(
            auto_pr, "run", side_effect=["app/page.tsx", "Closes #42", "https://github.com/owner/repo/pull/7\n"]
        ) as run:
            auto_pr.sync()
            args = run.call_args.args
            self.assertIn("--body-file", args)
            self.assertEqual(Path(args[-1]).read_text(), auto_pr.pr_content(self.issue)[1])

    def test_missing_api_key_fails_review(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}):
            with self.assertRaisesRegex(ValueError, "Missing repository secret OPENAI"):
                auto_pr.generate_review("diff", self.issue)

    def test_empty_diff_does_not_create_pr(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            "RUNNER_TEMP": directory, "GH_REPO": self.repo,
            "HEAD_BRANCH": "topic", "BASE_BRANCH": "main",
        }), patch.object(auto_pr, "gh_json", return_value=[]) as gh, patch.object(
            auto_pr, "run", return_value=""
        ):
            auto_pr.sync()
            self.assertIsNone(json.loads(auto_pr.context_path().read_text()))
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
                auto_pr.generate_review("diff", self.issue)

    def test_review_api_payload_and_truncation(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({
            "choices": [{"message": {"content": "沒有明確問題"}, "finish_reason": "stop"}]
        }).encode()
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}), patch.object(
            auto_pr.urllib.request, "urlopen", return_value=response
        ) as request:
            body = auto_pr.generate_review("x" * (auto_pr.DIFF_LIMIT + 1), self.issue)
            payload = json.loads(request.call_args.args[0].data)
            supplied = json.loads(payload["messages"][1]["content"])
            self.assertEqual(len(supplied["diff"]), auto_pr.DIFF_LIMIT)
            self.assertTrue(supplied["truncated"])
            self.assertIn("僅審查前 60,000", body)
            self.assertIn("未執行測試", body)

    def test_http_error_does_not_expose_response_or_key(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}), patch.object(
            auto_pr.urllib.request, "urlopen",
            side_effect=urllib.error.HTTPError("url", 429, "secret-response", {}, None),
        ):
            with self.assertRaisesRegex(ValueError, "^OpenAI API returned HTTP 429; AI review was not posted$"):
                auto_pr.generate_review("diff", self.issue)

    def run_review(self, responses):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.contexts.enter_context(patch.dict(os.environ, {
            "RUNNER_TEMP": directory.name, "GH_REPO": self.repo,
            "GITHUB_SHA": "abc", "BASE_BRANCH": "main",
        }))
        auto_pr.context_path().write_text(json.dumps({"pr": 7, "issue": self.issue}))
        gh = self.contexts.enter_context(patch.object(auto_pr, "gh_json", side_effect=responses))
        self.contexts.enter_context(patch.object(auto_pr, "run", return_value="diff"))
        generate = self.contexts.enter_context(patch.object(auto_pr, "generate_review", return_value="review"))
        auto_pr.review()
        return gh, generate

    def test_review_is_a_comment_pinned_to_commit(self):
        opened = {"headRefOid": "abc", "state": "OPEN"}
        gh, generate = self.run_review([opened, [[]], opened, {}])
        payload = gh.call_args.kwargs["payload"]
        self.assertEqual(payload["event"], "COMMENT")
        self.assertEqual(payload["commit_id"], "abc")
        self.assertIn(auto_pr.MARKER, payload["body"])
        generate.assert_called_once()

    def test_review_deduplicates_same_commit(self):
        gh, generate = self.run_review([
            {"headRefOid": "abc", "state": "OPEN"},
            [[{"commit_id": "abc", "body": auto_pr.MARKER}]],
        ])
        generate.assert_not_called()
        self.assertEqual(gh.call_count, 2)

    def test_new_push_during_review_prevents_stale_post(self):
        gh, generate = self.run_review([
            {"headRefOid": "abc", "state": "OPEN"}, [[]],
            {"headRefOid": "new", "state": "OPEN"},
        ])
        generate.assert_called_once()
        self.assertEqual(gh.call_count, 3)


if __name__ == "__main__":
    unittest.main()
