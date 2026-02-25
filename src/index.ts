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

interface TeamReputationResponse {
  team_id: string;
  team_name: string;
  score: number;
  grade: string;
  confidence: string;
  is_eligible: boolean;
  computed_at: string;
}

async function run(): Promise<void> {
  try {
    const agentId = core.getInput('agent-id') || '';
    const teamId = core.getInput('team-id') || '';
    const minScore = parseInt(core.getInput('min-score') || '0', 10);
    const minGrade = core.getInput('min-grade') || '';
    const apiUrl = core.getInput('api-url') || 'https://api.mnemom.ai';
    const shouldComment = core.getInput('comment') === 'true';

    if ((!agentId && !teamId) || (agentId && teamId)) {
      core.setFailed('Exactly one of agent-id or team-id must be provided');
      return;
    }

    const isTeam = !!teamId;
    const entityId = isTeam ? teamId : agentId;
    const entityLabel = isTeam ? 'Team' : 'Agent';

    core.setOutput('entity-type', isTeam ? 'team' : 'agent');
    core.info(`Checking reputation for ${entityLabel.toLowerCase()}: ${entityId}`);

    const url = isTeam
      ? `${apiUrl}/v1/teams/${encodeURIComponent(teamId)}/reputation`
      : `${apiUrl}/v1/reputation/${encodeURIComponent(agentId)}`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        core.setOutput('score', '0');
        core.setOutput('grade', 'NR');
        core.setOutput('tier', 'Not Rated');
        core.setOutput('passed', 'false');
        core.setFailed(`${entityLabel} ${entityId} has no reputation score`);
        return;
      }
      core.setFailed(`API error: ${response.status} ${response.statusText}`);
      return;
    }

    const data = (await response.json()) as ReputationResponse | TeamReputationResponse;

    core.setOutput('score', data.score.toString());
    core.setOutput('grade', data.grade);
    core.setOutput('tier', 'tier' in data ? data.tier : '');

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
          const badgeUrl = isTeam
            ? `${apiUrl}/v1/teams/${encodeURIComponent(teamId)}/reputation/badge.svg?variant=score_grade`
            : `${apiUrl}/v1/reputation/${encodeURIComponent(agentId)}/badge.svg?variant=score_grade`;
          const verifyUrl = isTeam
            ? `https://www.mnemom.ai/teams/${encodeURIComponent(teamId)}/reputation`
            : `https://www.mnemom.ai/reputation/${encodeURIComponent(agentId)}`;
          const body = [
            `## Mnemom Trust Score`,
            ``,
            `![Trust Score](${badgeUrl})`,
            ``,
            `| Metric | Value |`,
            `|--------|-------|`,
            `| Entity | ${entityLabel} |`,
            `| Score | ${data.score} |`,
            `| Grade | ${data.grade} |`,
            ...('tier' in data ? [`| Tier | ${data.tier} |`] : []),
            `| Status | ${passed ? '\u2705 Passed' : '\u274C Failed'} |`,
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
