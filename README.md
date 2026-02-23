# Mnemom Reputation Check

[![CI](https://github.com/mnemom/reputation-check/actions/workflows/ci.yml/badge.svg)](https://github.com/mnemom/reputation-check/actions/workflows/ci.yml)

A GitHub Action that checks an AI agent's [Mnemom Trust Score](https://www.mnemom.ai) in your CI/CD pipeline. Gate deployments, validate agent integrity, and post trust score badges on pull requests.

## Quick Start

```yaml
- uses: mnemom/reputation-check@v1
  with:
    agent-id: 'your-agent-id'
    min-score: '600'
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `agent-id` | The agent ID to check reputation for | Yes | |
| `min-score` | Minimum trust score required (0-1000) | No | `0` |
| `min-grade` | Minimum grade required (AAA, AA, A, BBB, BB, B, CCC) | No | |
| `api-url` | Mnemom API base URL | No | `https://api.mnemom.ai` |
| `comment` | Post a PR comment with the trust score badge (true/false) | No | `false` |

## Outputs

| Output | Description |
|--------|-------------|
| `score` | The agent trust score (0-1000) |
| `grade` | The agent trust grade (AAA-CCC or NR) |
| `tier` | The agent trust tier name |
| `passed` | Whether the agent passed the reputation check (true/false) |

## Examples

### Basic Score Check

Fail the workflow if an agent's trust score drops below 500:

```yaml
name: Reputation Gate
on: [push]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: mnemom/reputation-check@v1
        with:
          agent-id: 'agent_abc123'
          min-score: '500'
```

### Grade-Based Gating

Require a minimum grade of A before deploying:

```yaml
- uses: mnemom/reputation-check@v1
  with:
    agent-id: 'agent_abc123'
    min-grade: 'A'
```

### PR Comment with Trust Badge

Post a trust score summary as a PR comment. Requires `GITHUB_TOKEN`:

```yaml
name: Trust Check
on: pull_request
jobs:
  check:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: mnemom/reputation-check@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          agent-id: 'agent_abc123'
          min-score: '400'
          comment: 'true'
```

### Multiple Agents

Check multiple agents in the same workflow:

```yaml
name: Multi-Agent Check
on: [push]
jobs:
  check:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        agent:
          - agent_abc123
          - agent_def456
          - agent_ghi789
    steps:
      - uses: mnemom/reputation-check@v1
        with:
          agent-id: ${{ matrix.agent }}
          min-score: '600'
```

### Use Output in Subsequent Steps

Access the trust score in later steps:

```yaml
- uses: mnemom/reputation-check@v1
  id: trust
  with:
    agent-id: 'agent_abc123'

- run: echo "Agent scored ${{ steps.trust.outputs.score }} (${{ steps.trust.outputs.grade }})"

- if: steps.trust.outputs.grade == 'AAA'
  run: echo "Top-tier agent!"
```

## Grades and Scoring

Mnemom evaluates AI agents across multiple dimensions including alignment verification, behavioral consistency, and accountability. Scores range from 0 to 1000 and map to letter grades:

| Grade | Score Range | Description |
|-------|-------------|-------------|
| AAA | 900-1000 | Exceptional trust |
| AA | 800-899 | Very high trust |
| A | 700-799 | High trust |
| BBB | 600-699 | Good trust |
| BB | 500-599 | Adequate trust |
| B | 400-499 | Below average trust |
| CCC | 0-399 | Low trust |
| NR | N/A | Not yet rated |

For a detailed explanation of how scores are computed, see the [Mnemom Methodology](https://www.mnemom.ai/methodology).

## License

MIT
