import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL(
  "../../.github/workflows/deploy-dev.yml",
  import.meta.url,
);

async function readWorkflow() {
  return (await readFile(workflowUrl, "utf8")).replace(/\r\n/gu, "\n");
}

test("DEV publication is automatic only after a verified main push", async () => {
  const workflow = await readWorkflow();

  assert.match(workflow, /workflow_run:\n\s+workflows: \["Verify static harness"\]/u);
  assert.match(workflow, /branches: \[main\]/u);
  assert.match(workflow, /types: \[completed\]/u);
  assert.doesNotMatch(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/u);
  assert.match(workflow, /workflow_run\.event == 'push'/u);
  assert.match(workflow, /workflow_run\.head_branch == 'main'/u);
  assert.match(
    workflow,
    /workflow_run\.head_repository\.full_name == github\.repository/u,
  );
  assert.match(workflow, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/u);
});

test("DEV publication uses only the job-scoped repository package token", async () => {
  const workflow = await readWorkflow();
  const publishJob = workflow.slice(workflow.indexOf("  publish:"));

  assert.match(publishJob, /^    permissions:\n      contents: read\n      packages: write$/mu);
  assert.match(publishJob, /persist-credentials: false/u);
  assert.match(publishJob, /username: \$\{\{ github\.actor \}\}/u);
  assert.match(publishJob, /password: \$\{\{ secrets\.GITHUB_TOKEN \}\}/u);
  assert.doesNotMatch(workflow, /IAL_GHCR_TOKEN/u);
  assert.doesNotMatch(workflow, /environment:\s+production/u);
  assert.doesNotMatch(workflow, /:prod\b/u);
});
