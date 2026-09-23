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

const runtimeIdentity = IMAGE_NAME + ":prod@" + PREVIOUS_PROD_DIGEST;

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

test("promotion fails closed for a digest other than the pinned approval", async () => {
  const registry = new FixtureRegistry({
    sourceDigest: APPROVED_DIGEST,
    prodAliasDigest: PREVIOUS_PROD_DIGEST,
  });
  await assert.rejects(
    promoteProd({
      ...promotionOptions(registry),
      approvedDigest: PREVIOUS_PROD_DIGEST,
    }),
    /not the repository-pinned NOW-255 digest/u,
  );
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
  assert.match(
    workflow,
    /github\.ref == 'refs\/heads\/main' \|\| inputs\.execute == false/u,
  );
  assert.match(workflow, /username: isak-ialogics/u);
  assert.match(workflow, /secrets\.IAL_GHCR_TOKEN/u);
  assert.doesNotMatch(workflow, /secrets\.GITHUB_TOKEN/u);
  assert.doesNotMatch(workflow, /packages:\s+write/u);
  assert.match(workflow, /scripts\/prod-oci-release\.mjs/u);
  assert.doesNotMatch(
    workflow,
    /workflow_run:|build-push-action|docker\s+build|environment:/u,
  );
});
