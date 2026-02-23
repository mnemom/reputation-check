import * as core from '@actions/core';
import * as github from '@actions/github';

const GRADE_ORDINALS: Record<string, number> = {
  AAA: 7, AA: 6, A: 5, BBB: 4, BB: 3, B: 2, CCC: 1, NR: 0,
};

interface ReputationResponse {
  agent_id: string;
  score: number;
  grade: string;
  tier: string;
  is_eligible: boolean;
  computed_at: string;
}

async function run(): Promise<void> {
  try {
    const agentId = core.getInput('agent-id', { required: true });
    const minScore = parseInt(core.getInput('min-score') || '0', 10);
    const minGrade = core.getInput('min-grade') || '';
    const apiUrl = core.getInput('api-url') || 'https://api.mnemom.ai';
    const shouldComment = core.getInput('comment') === 'true';

    core.info(`Checking reputation for agent: ${agentId}`);

    const url = `${apiUrl}/v1/reputation/${encodeURIComponent(agentId)}`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        core.setOutput('score', '0');
        core.setOutput('grade', 'NR');
        core.setOutput('tier', 'Not Rated');
        core.setOutput('passed', 'false');
        core.setFailed(`Agent ${agentId} has no reputation score`);
        return;
      }
      core.setFailed(`API error: ${response.status} ${response.statusText}`);
      return;
    }

    const data = (await response.json()) as ReputationResponse;

    core.setOutput('score', data.score.toString());
    core.setOutput('grade', data.grade);
    core.setOutput('tier', data.tier);

    let passed = true;
    const reasons: string[] = [];

    if (minScore > 0 && data.score < minScore) {
      passed = false;
      reasons.push(`Score ${data.score} is below minimum ${minScore}`);
    }

    if (minGrade && GRADE_ORDINALS[minGrade] !== undefined) {
      const requiredOrdinal = GRADE_ORDINALS[minGrade];
      const actualOrdinal = GRADE_ORDINALS[data.grade] ?? 0;
      if (actualOrdinal < requiredOrdinal) {
        passed = false;
        reasons.push(`Grade ${data.grade} is below minimum ${minGrade}`);
      }
    }

    core.setOutput('passed', passed.toString());

    if (shouldComment && github.context.payload.pull_request) {
      try {
        const token = process.env.GITHUB_TOKEN;
        if (token) {
          const octokit = github.getOctokit(token);
          const badgeUrl = `${apiUrl}/v1/reputation/${encodeURIComponent(agentId)}/badge.svg?variant=score_grade`;
          const verifyUrl = `https://www.mnemom.ai/reputation/${encodeURIComponent(agentId)}`;
          const body = [
            `## Mnemom Trust Score`,
            ``,
            `![Trust Score](${badgeUrl})`,
            ``,
            `| Metric | Value |`,
            `|--------|-------|`,
            `| Score | ${data.score} |`,
            `| Grade | ${data.grade} |`,
            `| Tier | ${data.tier} |`,
            `| Status | ${passed ? '✅ Passed' : '❌ Failed'} |`,
            reasons.length > 0 ? `| Reason | ${reasons.join(', ')} |` : '',
            ``,
            `[View Full Report](${verifyUrl})`,
          ].filter(Boolean).join('\n');

          await octokit.rest.issues.createComment({
            ...github.context.repo,
            issue_number: github.context.payload.pull_request.number,
            body,
          });
        }
      } catch (commentError) {
        core.warning(`Failed to post PR comment: ${commentError}`);
      }
    }

    if (passed) {
      core.info(`Reputation check passed: score=${data.score}, grade=${data.grade}`);
    } else {
      core.setFailed(`Reputation check failed: ${reasons.join('; ')}`);
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Unknown error');
  }
}

run();
