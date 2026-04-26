# AGENTS.md — reputation-check

You are a coding agent working on **mnemom/reputation-check** — the
GitHub Action customers consume from their CI to gate deployments on
an agent's Mnemom Trust Score.

Audience: AI coding tools (Claude Code, Cursor, Cline, Aider) and
humans onboarding via them.

## What this repo is

A GitHub Action — single-purpose:

```yaml
- uses: mnemom/reputation-check@v0.5.0
  with:
    agent-id: 'your-agent-id'
    min-score: '600'
```

The action calls `https://api.mnemom.ai`, evaluates the score against
the threshold, and either passes or fails the workflow. Optional PR
comment with a trust-score badge.

License: Apache-2.0.

## Stack

- TypeScript compiled to a single bundled `dist/index.js` via
  `@vercel/ncc` so the published action is self-contained.
- Tests: Node's built-in `node --test` runner.
- Lint: eslint + prettier.

## Install + dev

```bash
npm install
npm test                # node --test __tests__/*.test.js
npm run typecheck       # tsc --noEmit
npm run lint            # eslint + prettier --check
npm run build           # ncc build src/index.ts -o dist
```

The `dist/` directory **is** committed to the repo — this is how
GitHub Actions are distributed. After any source change, rebuild and
commit `dist/` in the same PR. CI verifies that `dist/` matches what
`ncc build` produces.

## Project layout

```
src/                    # TypeScript source
  index.ts              # action entry point
__tests__/              # Node --test suite (.test.js files)
dist/                   # COMMITTED bundled output — required for GH Actions
action.yml              # Action manifest (inputs/outputs/branding)
README.md
```

## Conventions

- **`dist/` is part of the source.** Always rebuild and commit `dist/`
  in the same PR as any `src/` change. CI fails otherwise.
- **`action.yml` is the contract.** Input names, defaults, and
  descriptions are part of the public API. Renaming an input is a
  breaking change and requires a major-version tag.
- **Tag releases as `vX.Y.Z` and move `vX` major-version pointer.**
  Action consumers pin via either; both must work.
- **The action calls `https://api.mnemom.ai` only.** No cross-domain
  side effects, no telemetry to third parties.
- Commit messages: imperative, concise, describe the **why**.

## Branch protection + deploy

- Never commit directly to `main`. Always feature branch first.
- Branch protection enforced.
- Releases are git tags + GH Releases — no separate npm/PyPI
  publication. Consumers use `mnemom/reputation-check@vX.Y.Z`.

## What you should NOT do

- Don't ship a `src/` change without a fresh `dist/` rebuild.
- Don't add runtime dependencies that bloat `dist/` — every byte ships
  to every consumer's runner. Stick to `@actions/core` and
  `@actions/github`.
- Don't break input-name compatibility on a non-major bump.
- Don't skip pre-commit hooks (`--no-verify`).
- Don't `git push --force` to `main`.

## Cross-links

- **Trust Rating methodology** (the score this action gates on):
  https://www.mnemom.ai/methodology
- **Trust Directory** (where verified agents live):
  https://www.mnemom.ai/directory
- **Public Mnemom Agent-Readability Commitment**:
  https://www.mnemom.ai/for-agents
