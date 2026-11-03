## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### PR review

Before creating a PR or pushing branch changes that create or update one, run
`.agents/skills/code-review/SKILL.md` locally against the target branch's pinned
merge-base. Run Standards and Spec in parallel, fix actionable findings, and
recheck affected changes. Record the reviewed base/head, separate findings and
remaining limitations in the PR's Evidence section using the `pr` skill. Review
new changes before subsequent pushes. See `docs/auto-pr.md` for the full flow.

### Triage labels

The default five-label triage vocabulary is in use. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context domain-doc layout. See `docs/agents/domain.md`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
