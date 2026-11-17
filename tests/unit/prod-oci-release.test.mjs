import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  APPROVED_DIGEST,
  FixtureRegistry,
  FixtureRuntime,
  IMAGE_NAME,
  PREVIOUS_PROD_DIGEST,
  PROD_ALIAS,
  ROLLBACK_ORDER,
  promoteProd,
  promotionCreateArgs,
  rollbackProd,
} from "../../scripts/prod-oci-release.mjs";

const PR_43_DIGEST =
  "sha256:1e7d17844fed99610379a16f7e21468eb55981e801a165a8df2ec7644612c9ef";
const runtimeIdentity = IMAGE_NAME + ":prod@" + PREVIOUS_PROD_DIGEST;

function workflowJob(source, jobName) {
  source = source.replace(/\r\n/gu, '\n');
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  assert.notEqual(start, -1, `workflow job ${jobName} must exist`);
  const end = lines.findIndex(
    (line, index) => index > start && /^  [a-zA-Z0-9_-]+:\s*$/u.test(line),
  );
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

function workflowJobProperty(job, property) {
  const match = job.match(new RegExp(`^    ${property}:\\s*(.+)$`, "mu"));
  return match?.[1]?.trim();
}

function promotionDispatchPlan({ job, ref, allowedEnvironmentBranches, execute }) {
  const mainRef = "refs/heads/main";
  const branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : null;
  const jobRefAuthorized =
    workflowJobProperty(job, "if") === "github.ref == 'refs/heads/main'" &&
    ref === mainRef;
  const environmentAuthorized =
    workflowJobProperty(job, "environment") === "production" &&
    allowedEnvironmentBranches.includes(branch);
  const authorized = jobRefAuthorized && environmentAuthorized;

  return {
    authorized,
    jobRefAuthorized,
    environmentAuthorized,
    secretAvailable: authorized,
    registryReached: authorized,
    mutatesProd: authorized && execute,
  };
}

function promotionOptions(registry, overrides = {}) {
  return {
    registry,
    approvedDigest: APPROVED_DIGEST,
    expectedPreviousDigest: PREVIOUS_PROD_DIGEST,
    previousRuntimeIdentity: runtimeIdentity,
    previousRuntimeReplicas: "1/1",
    execute: true,
    capturedAt: "2026-09-23T00:00:00.000Z",
    ...overrides,
  };
}

test("release tooling accepts the exact PR #43 OCI index", async () => {
  assert.equal(APPROVED_DIGEST, PR_43_DIGEST);

  const registry = new FixtureRegistry({
    sourceDigest: PR_43_DIGEST,
    prodAliasDigest: PREVIOUS_PROD_DIGEST,
  });
  const receipt = await promoteProd({
    ...promotionOptions(registry),
    approvedDigest: PR_43_DIGEST,
    execute: false,
  });

  assert.equal(receipt.outcome, "no-mutation");
  assert.equal(receipt.after.plannedProdAliasDigest, PR_43_DIGEST);
});

test("runtime identity accepts digest-only and tag-plus-digest forms", async () => {
  for (const previousRuntimeIdentity of [
    IMAGE_NAME + "@" + PREVIOUS_PROD_DIGEST,
    IMAGE_NAME + ":prod@" + PREVIOUS_PROD_DIGEST,
  ]) {
    const registry = new FixtureRegistry({
      sourceDigest: APPROVED_DIGEST,
      prodAliasDigest: PREVIOUS_PROD_DIGEST,
    });
    const receipt = await promoteProd({
      ...promotionOptions(registry),
      previousRuntimeIdentity,
      execute: false,
    });

    assert.equal(receipt.outcome, "no-mutation");
    assert.equal(receipt.before.runtimeIdentity, previousRuntimeIdentity);
    assert.equal(registry.prodAliasDigest, PREVIOUS_PROD_DIGEST);
  }
});

test("invalid runtime identities fail before registry access", async () => {
  const invalidIdentities = [
    ["empty", ""],
    ["mutable tag only", IMAGE_NAME + ":prod"],
    [
      "wrong registry",
      "registry.example/isak-ialogics/nownow-games@" + PREVIOUS_PROD_DIGEST,
    ],
    [
      "wrong repository",
      "ghcr.io/isak-ialogics/other-games@" + PREVIOUS_PROD_DIGEST,
    ],
    ["short digest", IMAGE_NAME + "@sha256:" + "a".repeat(63)],
    ["malformed digest", IMAGE_NAME + "@sha256:" + "g".repeat(64)],
  ];

  for (const [label, previousRuntimeIdentity] of invalidIdentities) {
    const events = [];
    const registry = new FixtureRegistry(
      {
        sourceDigest: APPROVED_DIGEST,
        prodAliasDigest: PREVIOUS_PROD_DIGEST,
      },
      events,
    );

    await assert.rejects(
      promoteProd({
        ...promotionOptions(registry),
        previousRuntimeIdentity,
      }),
      /Runtime identity must be an immutable/u,
      label,
    );
    assert.deepEqual(events, [], label);
  }
});

test("promotion captures prior state then verifies the approved digest", async () => {
  const events = [];
  const saved = [];
  const registry = new FixtureRegistry(
    { sourceDigest: APPROVED_DIGEST, prodAliasDigest: PREVIOUS_PROD_DIGEST },
    events,
  );
  const receipt = await promoteProd({
    ...promotionOptions(registry),
    persistReceipt: async (value) => saved.push(structuredClone(value)),
  });

  assert.equal(receipt.outcome, "fixture-pass");
  assert.equal(receipt.after.prodAliasDigest, APPROVED_DIGEST);
  assert.equal(receipt.redacted, true);
  assert.doesNotMatch(
    JSON.stringify(receipt),
    /authorization|bearer|github_token|ial_ghcr_token|password/iu,
  );
  assert.equal(saved[0].phase, "preflight-captured");
  assert.equal(saved[0].before.prodAliasDigest, PREVIOUS_PROD_DIGEST);
  assert.equal(saved[0].before.runtimeIdentity, runtimeIdentity);
  assert.equal(saved[0].before.runtimeReplicas, "1/1");
  assert.deepEqual(events, [
    "registry:resolve:" + IMAGE_NAME + "@" + APPROVED_DIGEST,
    "registry:resolve:" + PROD_ALIAS,
    "registry:copy:" + IMAGE_NAME + "@" + APPROVED_DIGEST + "->" + PROD_ALIAS,
    "registry:resolve:" + PROD_ALIAS,
  ]);
});

test("dry run validates the planned copy without mutating the PROD alias", async () => {
  const events = [];
  const registry = new FixtureRegistry(
    { sourceDigest: APPROVED_DIGEST, prodAliasDigest: PREVIOUS_PROD_DIGEST },
    events,
  );
  const receipt = await promoteProd({
    ...promotionOptions(registry),
    execute: false,
  });

  assert.equal(receipt.outcome, "no-mutation");
  assert.equal(receipt.after.plannedProdAliasDigest, APPROVED_DIGEST);
  assert.equal(registry.prodAliasDigest, PREVIOUS_PROD_DIGEST);
  assert.equal(
    events.includes(
      "registry:copy:" +
        IMAGE_NAME +
        "@" +
        APPROVED_DIGEST +
        "->" +
        PROD_ALIAS +
        ":dry-run",
    ),
    true,
  );
});

test("promotion fails closed for a digest other than the PR #43 OCI index", async () => {
  const events = [];
  const otherDigest = "sha256:" + "f".repeat(64);
  const registry = new FixtureRegistry(
    {
      sourceDigest: PR_43_DIGEST,
      prodAliasDigest: PREVIOUS_PROD_DIGEST,
    },
    events,
  );
  await assert.rejects(
    promoteProd({
      ...promotionOptions(registry),
      approvedDigest: otherDigest,
    }),
    /not the repository-pinned PR #43 OCI index/u,
  );
  assert.deepEqual(events, []);
});

test("resolved source digest mismatch fails before copying", async () => {
  const events = [];
  class MismatchedSourceRegistry extends FixtureRegistry {
    async resolve(reference) {
      if (reference.startsWith(IMAGE_NAME + "@")) return PREVIOUS_PROD_DIGEST;
      return super.resolve(reference);
    }
  }
  const registry = new MismatchedSourceRegistry(
    { sourceDigest: PREVIOUS_PROD_DIGEST, prodAliasDigest: PREVIOUS_PROD_DIGEST },
    events,
  );
  await assert.rejects(promoteProd(promotionOptions(registry)), /Resolved source digest/u);
  assert.equal(events.some((event) => event.startsWith("registry:copy:")), false);
});

test("equality failure restores the prior alias before failing", async () => {
  const wrongDigest = "sha256:" + "f".repeat(64);
  const events = [];
  const receipts = [];
  const registry = new FixtureRegistry(
    {
      sourceDigest: APPROVED_DIGEST,
      prodAliasDigest: PREVIOUS_PROD_DIGEST,
      promotionDigest: wrongDigest,
    },
    events,
  );
  await assert.rejects(
    promoteProd({
      ...promotionOptions(registry),
      persistReceipt: async (receipt) => receipts.push(structuredClone(receipt)),
    }),
    /alias-restored-service-recovery-required/u,
  );
  assert.equal(registry.prodAliasDigest, PREVIOUS_PROD_DIGEST);
  assert.equal(receipts.at(-1).emergencyAliasRestore.verified, true);
  assert.deepEqual(events.slice(-2), [
    "registry:copy:" + IMAGE_NAME + "@" + PREVIOUS_PROD_DIGEST + "->" + PROD_ALIAS,
    "registry:resolve:" + PROD_ALIAS,
  ]);
});

test("rollback is alias-first and ends with alias plus runtime checks", async () => {
  const events = [];
  const registry = new FixtureRegistry(
    { sourceDigest: APPROVED_DIGEST, prodAliasDigest: APPROVED_DIGEST },
    events,
  );
  const runtime = new FixtureRuntime(
    { identity: runtimeIdentity, replicas: "1/1" },
    events,
  );
  const receipt = {
    schemaVersion: 1,
    image: IMAGE_NAME,
    before: {
      prodAliasDigest: PREVIOUS_PROD_DIGEST,
      runtimeIdentity,
      runtimeReplicas: "1/1",
    },
  };
  const result = await rollbackProd({ registry, runtime, receipt });

  assert.equal(result.rollback.phase, "verified");
  assert.deepEqual(result.rollback.order, ROLLBACK_ORDER);
  assert.deepEqual(events, [
    "registry:copy:" + IMAGE_NAME + "@" + PREVIOUS_PROD_DIGEST + "->" + PROD_ALIAS,
    "registry:resolve:" + PROD_ALIAS,
    "runtime:recover",
    "registry:resolve:" + PROD_ALIAS,
    "runtime:snapshot",
  ]);
});

test("promotion tooling contains no image build path", async () => {
  assert.deepEqual(
    promotionCreateArgs(IMAGE_NAME + "@" + APPROVED_DIGEST, PROD_ALIAS),
    [
      "buildx",
      "imagetools",
      "create",
      "--prefer-index=false",
      "--tag",
      PROD_ALIAS,
      IMAGE_NAME + "@" + APPROVED_DIGEST,
    ],
  );

  const workflow = await readFile(
    new URL("../../.github/workflows/deploy-prod.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /\|\|\s*inputs\.execute/u);
  assert.match(workflow, /username: isak-ialogics/u);
  assert.match(workflow, /secrets\.IAL_GHCR_TOKEN/u);
  assert.doesNotMatch(workflow, /secrets\.GITHUB_TOKEN/u);
  assert.doesNotMatch(workflow, /packages:\s+write/u);
  assert.match(workflow, /scripts\/prod-oci-release\.mjs/u);
  assert.doesNotMatch(
    workflow,
    /workflow_run:|build-push-action|docker\s+build/u,
  );
});

test("off-main manual dispatch is denied before secret or registry access", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/deploy-prod.yml", import.meta.url),
    "utf8",
  );
  const job = workflowJob(workflow, "promote");
  const plan = promotionDispatchPlan({
    job,
    ref: "refs/heads/now-261/protected-production-environment",
    allowedEnvironmentBranches: ["main"],
    execute: false,
  });

  assert.equal(workflowJobProperty(job, "environment"), "production");
  assert.match(job, /secrets\.IAL_GHCR_TOKEN/u);
  assert.deepEqual(plan, {
    authorized: false,
    jobRefAuthorized: false,
    environmentAuthorized: false,
    secretAvailable: false,
    registryReached: false,
    mutatesProd: false,
  });
});

test("authorized main dispatch permits a non-mutating preflight", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/deploy-prod.yml", import.meta.url),
    "utf8",
  );
  const job = workflowJob(workflow, "promote");
  const plan = promotionDispatchPlan({
    job,
    ref: "refs/heads/main",
    allowedEnvironmentBranches: ["main"],
    execute: false,
  });

  assert.deepEqual(plan, {
    authorized: true,
    jobRefAuthorized: true,
    environmentAuthorized: true,
    secretAvailable: true,
    registryReached: true,
    mutatesProd: false,
  });
});
