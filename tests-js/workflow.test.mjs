import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const WORKFLOW_PATH = new URL("../.github/workflows/public-market-scan.yml", import.meta.url);
const CI_WORKFLOW_PATH = new URL("../.github/workflows/ci.yml", import.meta.url);

test("public scan workflow is dispatch-only, least-privilege, and payload-free", async () => {
  const workflow = await readFile(WORKFLOW_PATH, "utf8");

  assert.match(workflow, /^on:\r?\n  workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s+schedule:/m);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request|workflow_call):/m);
  assert.match(workflow, /^permissions:\r?\n  contents: read$/m);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: public-scan-production/);
  assert.doesNotMatch(workflow, /upload-artifact|save-state|GITHUB_OUTPUT/);

  const jobsBlock = workflow.slice(workflow.indexOf("jobs:"));
  const jobNames = [...jobsBlock.matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm)].map((match) => match[1]);
  assert.deepEqual(jobNames, ["scan"]);

  const actionReferences = [...workflow.matchAll(/uses:\s+[^@\s]+@([^\s#]+)/g)].map((match) => match[1]);
  assert.ok(actionReferences.length > 0);
  assert.ok(actionReferences.every((revision) => /^[a-f0-9]{40}$/.test(revision)));

  assert.equal((workflow.match(/secrets\.PUBLIC_SCAN_HMAC_SECRET/g) ?? []).length, 1);
  const finalStepOffset = workflow.indexOf("Fetch, compute, and publish the authenticated scan");
  assert.ok(finalStepOffset > 0);
  assert.ok(workflow.indexOf("secrets.PUBLIC_SCAN_HMAC_SECRET") > finalStepOffset);
});

test("CI avoids duplicate feature-branch runs and cancels obsolete attempts", async () => {
  const workflow = await readFile(CI_WORKFLOW_PATH, "utf8");
  assert.match(workflow, /push:\r?\n\s+branches:\r?\n\s+- main/);
  assert.match(workflow, /^  pull_request:\s*$/m);
  assert.match(workflow, /group: ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/);
  assert.match(workflow, /cancel-in-progress: true/);
});
