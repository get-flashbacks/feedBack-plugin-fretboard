'use strict';
// Structural/security coverage for .github/workflows/pullfrog.yml.
//
// This workflow has no application logic to exercise directly, and this repo
// has no YAML-parsing dependency (no package.json, no node_modules), so these
// tests validate its shape with a tiny indentation-aware reader instead of a
// full YAML parser. They lock in the properties that matter most for a
// workflow that runs an AI agent with broad secrets access: manual-only
// trigger, least-privilege permissions, commit-SHA-pinned actions, and
// correctly wired provider secrets.
// Runs under the org reusable CI as `node tests/pullfrog-workflow.test.js`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW_PATH = path.join(__dirname, '..', '.github', 'workflows', 'pullfrog.yml');
const source = fs.readFileSync(WORKFLOW_PATH, 'utf8');
const lines = source.split('\n');

function indentOf(line) {
    return line.match(/^ */)[0].length;
}

function findIn(arr, regex, fromIndex = 0) {
    for (let i = fromIndex; i < arr.length; i++) {
        if (regex.test(arr[i])) return i;
    }
    return -1;
}

// Returns the lines that are more indented than the header line at
// `headerIndex`, i.e. its "children" in the indentation tree, stopping at
// the first sibling-or-shallower line (blank lines are kept, not treated
// as terminators).
function childBlockOf(arr, headerIndex) {
    const headerIndent = indentOf(arr[headerIndex]);
    const block = [];
    for (let i = headerIndex + 1; i < arr.length; i++) {
        const line = arr[i];
        if (line.trim() === '') { block.push(line); continue; }
        if (indentOf(line) <= headerIndent) break;
        block.push(line);
    }
    return block;
}

// Parses a flat `key: value` block (comments and blank lines ignored). A
// bare `key:` with no inline value is treated as a folded scalar whose
// value continues on the following more-indented line(s), e.g.
//   GOOGLE_GENERATIVE_AI_API_KEY:
//     ${{ secrets.GOOGLE_GENERATIVE_AI_API_KEY }}
function parseFlatMap(blockLines) {
    const active = blockLines.filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
    const map = {};
    let i = 0;
    while (i < active.length) {
        const line = active[i];
        const indent = indentOf(line);
        const trimmed = line.trim();
        const colon = trimmed.indexOf(':');
        const key = trimmed.slice(0, colon).trim();
        let value = trimmed.slice(colon + 1).trim();
        if (value === '') {
            const parts = [];
            let j = i + 1;
            while (j < active.length && indentOf(active[j]) > indent) {
                parts.push(active[j].trim());
                j++;
            }
            value = parts.join(' ');
            i = j;
        } else {
            i += 1;
        }
        map[key] = value;
    }
    return map;
}

function splitSteps(stepsBlock) {
    const steps = [];
    let current = null;
    for (const line of stepsBlock) {
        if (/^\s*- name:/.test(line)) {
            current = [line];
            steps.push(current);
        } else if (current) {
            current.push(line);
        }
    }
    return steps;
}

test('workflow file exists and is non-empty', () => {
    assert.ok(source.length > 0);
});

test('carries the do-not-edit banner as its first line', () => {
    assert.equal(lines[0], '# PULLFROG ACTION — DO NOT EDIT EXCEPT WHERE INDICATED');
});

test('declares only the expected top-level keys, in order', () => {
    const topLevelKeys = lines
        .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'))
        .filter((l) => indentOf(l) === 0)
        .map((l) => l.trim().split(':')[0]);
    assert.deepEqual(topLevelKeys, ['name', 'run-name', 'on', 'permissions', 'jobs']);
});

test('is named Pullfrog with a run-name derived from the dispatch input', () => {
    assert.match(source, /^name: Pullfrog$/m);
    assert.match(source, /^run-name: \$\{\{ inputs\.name \|\| github\.workflow \}\}$/m);
});

test('triggers only via manual workflow_dispatch, not push or pull_request', () => {
    const onIdx = findIn(lines, /^on:$/);
    assert.notEqual(onIdx, -1, 'expected a top-level `on:` key');
    const onBlock = childBlockOf(lines, onIdx);
    assert.match(onBlock.join('\n'), /^\s+workflow_dispatch:$/m);
    assert.doesNotMatch(onBlock.join('\n'), /^\s+push:/m);
    assert.doesNotMatch(onBlock.join('\n'), /^\s+pull_request:/m);
});

test('workflow_dispatch exposes exactly a prompt and a name string input', () => {
    const dispatchIdx = findIn(lines, /^\s+workflow_dispatch:$/);
    const inputsIdx = findIn(lines, /^\s+inputs:$/, dispatchIdx);
    const inputsBlock = childBlockOf(lines, inputsIdx);
    const inputNames = inputsBlock
        .filter((l) => l.trim() !== '')
        .filter((l, idx, arr) => indentOf(l) === indentOf(arr.find((x) => x.trim() !== '')))
        .map((l) => l.trim().replace(/:$/, ''));
    assert.deepEqual(inputNames, ['prompt', 'name']);

    const promptIdx = findIn(inputsBlock, /^\s*prompt:$/);
    const promptMap = parseFlatMap(childBlockOf(inputsBlock, promptIdx));
    assert.equal(promptMap.type, 'string');
    assert.equal(promptMap.description, 'Agent prompt');

    const nameIdx = findIn(inputsBlock, /^\s*name:$/);
    const nameMap = parseFlatMap(childBlockOf(inputsBlock, nameIdx));
    assert.equal(nameMap.type, 'string');
    assert.equal(nameMap.description, 'Run name');
});

test('top-level permissions grant only read access to contents', () => {
    const permIdx = findIn(lines, /^permissions:$/);
    const permMap = parseFlatMap(childBlockOf(lines, permIdx));
    assert.deepEqual(permMap, { contents: 'read' });
});

test('defines a single job named pullfrog running on ubuntu-latest', () => {
    const jobsIdx = findIn(lines, /^jobs:$/);
    const jobsBlock = childBlockOf(lines, jobsIdx);
    const jobNames = jobsBlock
        .filter((l) => l.trim() !== '')
        .filter((l) => indentOf(l) === indentOf(jobsBlock.find((x) => x.trim() !== '')))
        .map((l) => l.trim().replace(/:$/, ''));
    assert.deepEqual(jobNames, ['pullfrog']);

    const runsOnIdx = findIn(jobsBlock, /^\s*runs-on:/);
    assert.equal(jobsBlock[runsOnIdx].trim(), 'runs-on: ubuntu-latest');
});

test('job permissions escalate only to id-token: write, keeping contents read-only', () => {
    const jobsIdx = findIn(lines, /^jobs:$/);
    const jobsBlock = childBlockOf(lines, jobsIdx);
    const jobPermIdx = findIn(jobsBlock, /^\s*permissions:$/);
    const jobPermMap = parseFlatMap(childBlockOf(jobsBlock, jobPermIdx));
    assert.deepEqual(jobPermMap, { 'id-token': 'write', contents: 'read' });
});

test('no permission anywhere in the file grants write beyond id-token', () => {
    const writeLines = lines.filter((l) => /:\s*write\s*$/.test(l.trim()));
    assert.equal(writeLines.length, 1);
    assert.match(writeLines[0], /id-token: write/);
});

function getSteps() {
    const jobsIdx = findIn(lines, /^jobs:$/);
    const jobsBlock = childBlockOf(lines, jobsIdx);
    const stepsIdx = findIn(jobsBlock, /^\s*steps:$/);
    const stepsBlock = childBlockOf(jobsBlock, stepsIdx);
    return splitSteps(stepsBlock);
}

test('runs exactly two steps: checkout, then the Pullfrog agent', () => {
    const steps = getSteps();
    assert.equal(steps.length, 2);
    assert.match(steps[0][0], /- name: Checkout code/);
    assert.match(steps[1][0], /- name: Run agent/);
});

test('checkout step is pinned to a full commit SHA and disables credential persistence', () => {
    const [checkoutStep] = getSteps();
    const children = childBlockOf(checkoutStep, 0);

    const usesIdx = findIn(children, /^\s*uses:/);
    const usesLine = children[usesIdx].trim();
    assert.match(
        usesLine,
        /^uses: actions\/checkout@[0-9a-f]{40} # v\d+$/,
        'checkout action must be pinned to a 40-char commit SHA with a version comment',
    );

    const withIdx = findIn(children, /^\s*with:$/);
    const withMap = parseFlatMap(childBlockOf(children, withIdx));
    assert.deepEqual(withMap, { 'fetch-depth': '1', 'persist-credentials': 'false' });
});

test('agent step is pinned to a full commit SHA and forwards the dispatch prompt', () => {
    const [, agentStep] = getSteps();
    const children = childBlockOf(agentStep, 0);

    const usesIdx = findIn(children, /^\s*uses:/);
    const usesLine = children[usesIdx].trim();
    assert.match(
        usesLine,
        /^uses: pullfrog\/pullfrog@[0-9a-f]{40} # v\d+$/,
        'pullfrog action must be pinned to a 40-char commit SHA with a version comment',
    );

    const withIdx = findIn(children, /^\s*with:$/);
    const withMap = parseFlatMap(childBlockOf(children, withIdx));
    assert.deepEqual(withMap, { prompt: '${{ inputs.prompt }}' });
});

test('every active env secret is wired to a secrets entry with the same name', () => {
    const [, agentStep] = getSteps();
    const children = childBlockOf(agentStep, 0);
    const envIdx = findIn(children, /^\s*env:$/);
    const envMap = parseFlatMap(childBlockOf(children, envIdx));

    const expectedKeys = [
        'ANTHROPIC_API_KEY',
        'CLAUDE_CODE_OAUTH_TOKEN',
        'OPENAI_API_KEY',
        'GOOGLE_GENERATIVE_AI_API_KEY',
        'GEMINI_API_KEY',
        'XAI_API_KEY',
        'DEEPSEEK_API_KEY',
        'MOONSHOT_API_KEY',
        'OPENROUTER_API_KEY',
        'OPENCODE_API_KEY',
    ];
    assert.deepEqual(Object.keys(envMap).sort(), [...expectedKeys].sort());

    for (const key of expectedKeys) {
        assert.equal(
            envMap[key],
            `\${{ secrets.${key} }}`,
            `${key} should reference secrets.${key} with no typo/mismatch`,
        );
    }
});

test('optional provider blocks (Bedrock, Vertex AI, OpenAI-compatible) stay commented out by default', () => {
    const [, agentStep] = getSteps();
    const children = childBlockOf(agentStep, 0);
    const envIdx = findIn(children, /^\s*env:$/);
    const envBlock = childBlockOf(children, envIdx);
    const envMap = parseFlatMap(envBlock);

    const optionalKeys = [
        'AWS_BEARER_TOKEN_BEDROCK',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'AWS_REGION',
        'BEDROCK_MODEL_ID',
        'VERTEX_SERVICE_ACCOUNT_JSON',
        'GOOGLE_CLOUD_PROJECT',
        'VERTEX_LOCATION',
        'VERTEX_MODEL_ID',
        'OPENAI_COMPATIBLE_BASE_URL',
        'OPENAI_COMPATIBLE_API_KEY',
        'OPENAI_COMPATIBLE_MODEL',
        'OPENAI_COMPATIBLE_CONTEXT',
        'OPENAI_COMPATIBLE_MAX_OUTPUT',
    ];
    for (const key of optionalKeys) {
        assert.ok(!(key in envMap), `${key} should not be active by default`);
    }

    // The commented-out lines should still exist verbatim (as `#`-prefixed
    // guidance), so an editor can find and uncomment them.
    for (const key of optionalKeys) {
        assert.match(envBlock.join('\n'), new RegExp(`^\\s*# ${key}:`, 'm'));
    }
});