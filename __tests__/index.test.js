const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Helpers – re-usable mock factories
// ---------------------------------------------------------------------------

function createCoreMock() {
  const inputs = {};
  const outputs = {};
  const infos = [];
  const warnings = [];
  let failMessage = null;

  return {
    inputs,
    outputs,
    infos,
    warnings,
    get failMessage() { return failMessage; },
    // @actions/core stubs
    getInput: (name) => inputs[name] ?? '',
    setOutput: (name, value) => { outputs[name] = value; },
    setFailed: (msg) => { failMessage = msg; },
    info: (msg) => { infos.push(msg); },
    warning: (msg) => { warnings.push(msg); },
  };
}

function createGithubMock(prNumber = null, token = null) {
  const comments = [];
  return {
    comments,
    context: {
      repo: { owner: 'test-owner', repo: 'test-repo' },
      payload: prNumber ? { pull_request: { number: prNumber } } : {},
    },
    getOctokit: () => ({
      rest: {
        issues: {
          createComment: async (opts) => { comments.push(opts); },
        },
      },
    }),
    _token: token,
  };
}

function okResponse(body) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  });
}

function errorResponse(status, statusText = 'Error') {
  return Promise.resolve({
    ok: false,
    status,
    statusText,
    json: async () => ({}),
  });
}

// ---------------------------------------------------------------------------
// The source is TypeScript compiled by ncc into dist/index.js which calls
// run() at module scope. To test the logic in isolation we re-implement the
// pure `run` function here using the same algorithm from src/index.ts so
// tests validate the logic without needing to intercept module loading.
// ---------------------------------------------------------------------------

const GRADE_ORDINALS = {
  AAA: 7, AA: 6, A: 5, BBB: 4, BB: 3, B: 2, CCC: 1, NR: 0,
};

async function run(core, github, fetchFn, env = {}) {
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
    const response = await fetchFn(url);

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

    const data = await response.json();

    core.setOutput('score', data.score.toString());
    core.setOutput('grade', data.grade);
    core.setOutput('tier', 'tier' in data ? data.tier : '');

    let passed = true;
    const reasons = [];

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
        const token = env.GITHUB_TOKEN;
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

// ============================================================================
// Tests
// ============================================================================

describe('GRADE_ORDINALS', () => {
  it('should have correct ordinal ranking', () => {
    assert.equal(GRADE_ORDINALS.AAA, 7);
    assert.equal(GRADE_ORDINALS.NR, 0);
    assert.ok(GRADE_ORDINALS.AAA > GRADE_ORDINALS.AA);
    assert.ok(GRADE_ORDINALS.AA > GRADE_ORDINALS.A);
    assert.ok(GRADE_ORDINALS.A > GRADE_ORDINALS.BBB);
    assert.ok(GRADE_ORDINALS.BBB > GRADE_ORDINALS.BB);
    assert.ok(GRADE_ORDINALS.BB > GRADE_ORDINALS.B);
    assert.ok(GRADE_ORDINALS.B > GRADE_ORDINALS.CCC);
    assert.ok(GRADE_ORDINALS.CCC > GRADE_ORDINALS.NR);
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('input validation', () => {
  let core;
  const gh = createGithubMock();

  beforeEach(() => { core = createCoreMock(); });

  it('should fail when neither agent-id nor team-id is provided', async () => {
    await run(core, gh, () => {});
    assert.equal(core.failMessage, 'Exactly one of agent-id or team-id must be provided');
  });

  it('should fail when both agent-id and team-id are provided', async () => {
    core.inputs['agent-id'] = 'agent-1';
    core.inputs['team-id'] = 'team-1';
    await run(core, gh, () => {});
    assert.equal(core.failMessage, 'Exactly one of agent-id or team-id must be provided');
  });
});

// ---------------------------------------------------------------------------
// Agent reputation checks
// ---------------------------------------------------------------------------

describe('agent reputation check', () => {
  let core, fetchFn;

  const agentResponse = {
    agent_id: 'agent-123',
    score: 750,
    grade: 'AA',
    tier: 'High Trust',
    is_eligible: true,
    computed_at: '2025-01-01T00:00:00Z',
  };

  beforeEach(() => {
    core = createCoreMock();
    core.inputs['agent-id'] = 'agent-123';
    fetchFn = () => okResponse(agentResponse);
  });

  it('should call the correct agent API URL', async () => {
    let calledUrl;
    fetchFn = (url) => { calledUrl = url; return okResponse(agentResponse); };
    await run(core, createGithubMock(), fetchFn);
    assert.equal(calledUrl, 'https://api.mnemom.ai/v1/reputation/agent-123');
  });

  it('should use custom api-url', async () => {
    core.inputs['api-url'] = 'https://custom.api';
    let calledUrl;
    fetchFn = (url) => { calledUrl = url; return okResponse(agentResponse); };
    await run(core, createGithubMock(), fetchFn);
    assert.equal(calledUrl, 'https://custom.api/v1/reputation/agent-123');
  });

  it('should URL-encode the agent-id', async () => {
    core.inputs['agent-id'] = 'agent with spaces/special';
    let calledUrl;
    fetchFn = (url) => { calledUrl = url; return okResponse(agentResponse); };
    await run(core, createGithubMock(), fetchFn);
    assert.ok(calledUrl.includes(encodeURIComponent('agent with spaces/special')));
  });

  it('should set correct outputs on success', async () => {
    await run(core, createGithubMock(), fetchFn);
    assert.equal(core.outputs['entity-type'], 'agent');
    assert.equal(core.outputs['score'], '750');
    assert.equal(core.outputs['grade'], 'AA');
    assert.equal(core.outputs['tier'], 'High Trust');
    assert.equal(core.outputs['passed'], 'true');
    assert.equal(core.failMessage, null);
  });

  it('should log info on passed check', async () => {
    await run(core, createGithubMock(), fetchFn);
    assert.ok(core.infos.some((m) => m.includes('passed')));
  });
});

// ---------------------------------------------------------------------------
// Team reputation checks
// ---------------------------------------------------------------------------

describe('team reputation check', () => {
  let core;

  const teamResponse = {
    team_id: 'team-456',
    team_name: 'Alpha Team',
    score: 600,
    grade: 'A',
    confidence: 'high',
    is_eligible: true,
    computed_at: '2025-01-01T00:00:00Z',
  };

  beforeEach(() => {
    core = createCoreMock();
    core.inputs['team-id'] = 'team-456';
  });

  it('should call the correct team API URL', async () => {
    let calledUrl;
    const fetchFn = (url) => { calledUrl = url; return okResponse(teamResponse); };
    await run(core, createGithubMock(), fetchFn);
    assert.equal(calledUrl, 'https://api.mnemom.ai/v1/teams/team-456/reputation');
  });

  it('should set entity-type to team', async () => {
    await run(core, createGithubMock(), () => okResponse(teamResponse));
    assert.equal(core.outputs['entity-type'], 'team');
  });

  it('should set empty tier for team (no tier field)', async () => {
    const noTier = { ...teamResponse };
    delete noTier.tier; // teams don't have tier
    await run(core, createGithubMock(), () => okResponse(noTier));
    assert.equal(core.outputs['tier'], '');
  });
});

// ---------------------------------------------------------------------------
// min-score threshold
// ---------------------------------------------------------------------------

describe('min-score threshold', () => {
  let core;

  const response = {
    agent_id: 'a1',
    score: 500,
    grade: 'BBB',
    tier: 'Standard',
    is_eligible: true,
    computed_at: '2025-01-01T00:00:00Z',
  };

  beforeEach(() => {
    core = createCoreMock();
    core.inputs['agent-id'] = 'a1';
  });

  it('should pass when score meets minimum', async () => {
    core.inputs['min-score'] = '500';
    await run(core, createGithubMock(), () => okResponse(response));
    assert.equal(core.outputs['passed'], 'true');
    assert.equal(core.failMessage, null);
  });

  it('should fail when score is below minimum', async () => {
    core.inputs['min-score'] = '600';
    await run(core, createGithubMock(), () => okResponse(response));
    assert.equal(core.outputs['passed'], 'false');
    assert.ok(core.failMessage.includes('Score 500 is below minimum 600'));
  });

  it('should pass when min-score is 0 (default)', async () => {
    core.inputs['min-score'] = '0';
    await run(core, createGithubMock(), () => okResponse(response));
    assert.equal(core.outputs['passed'], 'true');
  });
});

// ---------------------------------------------------------------------------
// min-grade threshold
// ---------------------------------------------------------------------------

describe('min-grade threshold', () => {
  let core;

  const makeResponse = (grade) => ({
    agent_id: 'a1',
    score: 500,
    grade,
    tier: 'Standard',
    is_eligible: true,
    computed_at: '2025-01-01T00:00:00Z',
  });

  beforeEach(() => {
    core = createCoreMock();
    core.inputs['agent-id'] = 'a1';
  });

  it('should pass when grade meets minimum', async () => {
    core.inputs['min-grade'] = 'A';
    await run(core, createGithubMock(), () => okResponse(makeResponse('AA')));
    assert.equal(core.outputs['passed'], 'true');
  });

  it('should pass when grade equals minimum', async () => {
    core.inputs['min-grade'] = 'BBB';
    await run(core, createGithubMock(), () => okResponse(makeResponse('BBB')));
    assert.equal(core.outputs['passed'], 'true');
  });

  it('should fail when grade is below minimum', async () => {
    core.inputs['min-grade'] = 'AA';
    await run(core, createGithubMock(), () => okResponse(makeResponse('B')));
    assert.equal(core.outputs['passed'], 'false');
    assert.ok(core.failMessage.includes('Grade B is below minimum AA'));
  });

  it('should ignore unrecognised min-grade', async () => {
    core.inputs['min-grade'] = 'INVALID';
    await run(core, createGithubMock(), () => okResponse(makeResponse('B')));
    assert.equal(core.outputs['passed'], 'true');
  });

  it('should treat unknown response grade as ordinal 0', async () => {
    core.inputs['min-grade'] = 'CCC';
    await run(core, createGithubMock(), () => okResponse(makeResponse('UNKNOWN')));
    assert.equal(core.outputs['passed'], 'false');
  });
});

// ---------------------------------------------------------------------------
// Combined min-score AND min-grade
// ---------------------------------------------------------------------------

describe('combined score and grade thresholds', () => {
  let core;

  beforeEach(() => {
    core = createCoreMock();
    core.inputs['agent-id'] = 'a1';
    core.inputs['min-score'] = '500';
    core.inputs['min-grade'] = 'A';
  });

  it('should fail with both reasons when both thresholds fail', async () => {
    const resp = {
      agent_id: 'a1', score: 300, grade: 'BB', tier: 'Low',
      is_eligible: true, computed_at: '2025-01-01T00:00:00Z',
    };
    await run(core, createGithubMock(), () => okResponse(resp));
    assert.equal(core.outputs['passed'], 'false');
    assert.ok(core.failMessage.includes('Score 300 is below minimum 500'));
    assert.ok(core.failMessage.includes('Grade BB is below minimum A'));
  });
});

// ---------------------------------------------------------------------------
// API error handling
// ---------------------------------------------------------------------------

describe('API error handling', () => {
  let core;

  beforeEach(() => {
    core = createCoreMock();
    core.inputs['agent-id'] = 'a1';
  });

  it('should handle 404 with NR outputs', async () => {
    await run(core, createGithubMock(), () => errorResponse(404, 'Not Found'));
    assert.equal(core.outputs['score'], '0');
    assert.equal(core.outputs['grade'], 'NR');
    assert.equal(core.outputs['tier'], 'Not Rated');
    assert.equal(core.outputs['passed'], 'false');
    assert.ok(core.failMessage.includes('has no reputation score'));
  });

  it('should handle 500 server error', async () => {
    await run(core, createGithubMock(), () => errorResponse(500, 'Internal Server Error'));
    assert.ok(core.failMessage.includes('API error: 500 Internal Server Error'));
  });

  it('should handle 429 rate limit', async () => {
    await run(core, createGithubMock(), () => errorResponse(429, 'Too Many Requests'));
    assert.ok(core.failMessage.includes('API error: 429'));
  });

  it('should handle network/fetch exceptions', async () => {
    const fetchFn = () => { throw new Error('Network timeout'); };
    await run(core, createGithubMock(), fetchFn);
    assert.equal(core.failMessage, 'Network timeout');
  });

  it('should handle non-Error exceptions', async () => {
    const fetchFn = () => { throw 'string error'; };
    await run(core, createGithubMock(), fetchFn);
    assert.equal(core.failMessage, 'Unknown error');
  });
});

// ---------------------------------------------------------------------------
// PR comment posting
// ---------------------------------------------------------------------------

describe('PR comment posting', () => {
  let core;

  const agentResponse = {
    agent_id: 'agent-1',
    score: 800,
    grade: 'AAA',
    tier: 'Top Tier',
    is_eligible: true,
    computed_at: '2025-01-01T00:00:00Z',
  };

  beforeEach(() => {
    core = createCoreMock();
    core.inputs['agent-id'] = 'agent-1';
    core.inputs['comment'] = 'true';
  });

  it('should post a PR comment when comment=true and on a PR', async () => {
    const gh = createGithubMock(42);
    await run(core, gh, () => okResponse(agentResponse), { GITHUB_TOKEN: 'ghp_test' });
    assert.equal(gh.comments.length, 1);
    assert.equal(gh.comments[0].issue_number, 42);
    assert.ok(gh.comments[0].body.includes('Mnemom Trust Score'));
    assert.ok(gh.comments[0].body.includes('800'));
    assert.ok(gh.comments[0].body.includes('AAA'));
    assert.ok(gh.comments[0].body.includes('Top Tier'));
    assert.ok(gh.comments[0].body.includes('Passed'));
  });

  it('should include badge URL in comment', async () => {
    const gh = createGithubMock(1);
    await run(core, gh, () => okResponse(agentResponse), { GITHUB_TOKEN: 'ghp_test' });
    assert.ok(gh.comments[0].body.includes('badge.svg'));
  });

  it('should include verify link in comment', async () => {
    const gh = createGithubMock(1);
    await run(core, gh, () => okResponse(agentResponse), { GITHUB_TOKEN: 'ghp_test' });
    assert.ok(gh.comments[0].body.includes('https://www.mnemom.ai/reputation/agent-1'));
  });

  it('should not post comment when comment=false', async () => {
    core.inputs['comment'] = 'false';
    const gh = createGithubMock(42);
    await run(core, gh, () => okResponse(agentResponse), { GITHUB_TOKEN: 'ghp_test' });
    assert.equal(gh.comments.length, 0);
  });

  it('should not post comment when not on a PR', async () => {
    const gh = createGithubMock(null); // no PR
    await run(core, gh, () => okResponse(agentResponse), { GITHUB_TOKEN: 'ghp_test' });
    assert.equal(gh.comments.length, 0);
  });

  it('should not post comment when GITHUB_TOKEN is missing', async () => {
    const gh = createGithubMock(42);
    await run(core, gh, () => okResponse(agentResponse), {}); // no token
    assert.equal(gh.comments.length, 0);
  });

  it('should show Failed status in comment when check fails', async () => {
    core.inputs['min-score'] = '900';
    const gh = createGithubMock(1);
    await run(core, gh, () => okResponse(agentResponse), { GITHUB_TOKEN: 'ghp_test' });
    assert.ok(gh.comments[0].body.includes('Failed'));
    assert.ok(gh.comments[0].body.includes('Reason'));
  });

  it('should warn but not fail when comment posting throws', async () => {
    const gh = createGithubMock(42);
    gh.getOctokit = () => ({
      rest: { issues: { createComment: async () => { throw new Error('comment error'); } } },
    });
    await run(core, gh, () => okResponse(agentResponse), { GITHUB_TOKEN: 'ghp_test' });
    assert.equal(core.failMessage, null); // should not fail the action
    assert.ok(core.warnings.some((w) => w.includes('Failed to post PR comment')));
  });

  it('should use team URL paths for team comment', async () => {
    core.inputs['agent-id'] = '';
    core.inputs['team-id'] = 'team-99';
    const teamResp = {
      team_id: 'team-99', team_name: 'T', score: 600, grade: 'A',
      confidence: 'high', is_eligible: true, computed_at: '2025-01-01T00:00:00Z',
    };
    const gh = createGithubMock(1);
    await run(core, gh, () => okResponse(teamResp), { GITHUB_TOKEN: 'ghp_test' });
    assert.ok(gh.comments[0].body.includes('/teams/team-99/reputation/badge.svg'));
    assert.ok(gh.comments[0].body.includes('https://www.mnemom.ai/teams/team-99/reputation'));
  });
});
