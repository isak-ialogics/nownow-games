import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFile = promisify(execFileCallback);

export const IMAGE_NAME = "ghcr.io/isak-ialogics/nownow-games";
export const PROD_ALIAS = IMAGE_NAME + ":prod";
export const APPROVED_DIGEST =
  "sha256:729dd520ba422a65e69a7c70aaf92addb53e379bdfed4e468d2abb63e62876c0";
export const PREVIOUS_PROD_DIGEST =
  "sha256:20d3055817bbbd2b83abbd5ca462d869b105c3e176da4e669ad34eb862fcd3d1";
export const PROD_SERVICE = "prod-nownow-games_static";
export const ROLLBACK_ORDER = [
  "restore-prod-alias",
  "verify-restored-alias",
  "recover-service",
  "verify-prod-alias",
  "verify-steady-runtime",
];

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const servicePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u;

function fail(message) {
  throw new Error(message);
}

export function validateDigest(value, label = "digest") {
  if (!digestPattern.test(value ?? "")) {
    fail(label + " must be a lowercase sha256 digest.");
  }
  return value;
}

export function digestFromRuntimeIdentity(identity) {
  const match = (identity ?? "").match(/@(sha256:[a-f0-9]{64})$/u);
  if (!match || !identity.startsWith(IMAGE_NAME + ":")) {
    fail("Runtime identity must be an immutable " + IMAGE_NAME + ":<tag>@sha256 reference.");
  }
  return match[1];
}

export function validateReplicas(value) {
  const match = (value ?? "").match(/^(\d+)\/(\d+)$/u);
  if (!match) fail("Runtime replicas must use running/desired form, for example 1/1.");
  const running = Number(match[1]);
  const desired = Number(match[2]);
  if (desired < 1 || running !== desired) fail("Runtime must be steady before promotion.");
  return value;
}

function assertDigestEqual(actual, expected, label) {
  validateDigest(actual, label);
  if (actual !== expected) {
    fail(label + " " + actual + " does not equal required digest " + expected + ".");
  }
}

function sourceRef(digest) {
  return IMAGE_NAME + "@" + digest;
}

export function promotionCreateArgs(source, target, { dryRun = false } = {}) {
  const args = [
    "buildx",
    "imagetools",
    "create",
    "--prefer-index=false",
    "--tag",
    target,
  ];
  if (dryRun) args.push("--dry-run");
  args.push(source);
  return args;
}

async function writeReceipt(path, receipt) {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, JSON.stringify(receipt, null, 2) + "\n", "utf8");
}

export class DockerRegistry {
  constructor({ run = execFile } = {}) {
    this.run = run;
    this.kind = "registry";
  }

  async resolve(reference) {
    const { stdout } = await this.run("docker", [
      "buildx",
      "imagetools",
      "inspect",
      reference,
      "--format",
      "{{.Manifest.Digest}}",
    ]);
    return validateDigest(stdout.trim(), "Resolved " + reference);
  }

  async copy(source, target, { dryRun = false } = {}) {
    await this.run("docker", promotionCreateArgs(source, target, { dryRun }));
    return {
      plannedDigest: validateDigest(source.split("@").at(-1), "Pinned source digest"),
    };
  }
}

export class DockerProdRuntime {
  constructor({ run = execFile, serviceName = PROD_SERVICE } = {}) {
    if (!servicePattern.test(serviceName)) fail("Invalid Docker service name.");
    this.run = run;
    this.serviceName = serviceName;
  }

  async recover() {
    await this.run("/opt/ial-deploy/deploy.sh", [
      "nownow-games",
      "--env",
      "prod",
      "--rollback",
    ]);
  }

  async snapshot() {
    const [{ stdout: identity }, { stdout: serviceRow }] = await Promise.all([
      this.run("docker", [
        "service",
        "inspect",
        "--format",
        "{{.Spec.TaskTemplate.ContainerSpec.Image}}",
        this.serviceName,
      ]),
      this.run("docker", [
        "service",
        "ls",
        "--filter",
        "name=" + this.serviceName,
        "--format",
        "{{.Name}}|{{.Replicas}}",
      ]),
    ]);
    const row = serviceRow
      .trim()
      .split("\n")
      .find((line) => line.startsWith(this.serviceName + "|"));
    if (!row) fail("Docker service " + this.serviceName + " was not found.");
    return { identity: identity.trim(), replicas: row.split("|").at(-1) };
  }
}

export class FixtureRegistry {
  constructor(
    { sourceDigest, prodAliasDigest, promotionDigest = sourceDigest },
    events = [],
  ) {
    this.kind = "fixture";
    this.sourceDigest = sourceDigest;
    this.prodAliasDigest = prodAliasDigest;
    this.promotionDigest = promotionDigest;
    this.events = events;
  }

  async resolve(reference) {
    this.events.push("registry:resolve:" + reference);
    if (reference === PROD_ALIAS) return this.prodAliasDigest;
    if (reference === sourceRef(APPROVED_DIGEST)) return this.sourceDigest;
    if (reference.startsWith(IMAGE_NAME + "@")) return reference.split("@").at(-1);
    fail("Fixture cannot resolve " + reference + ".");
  }

  async copy(source, target, { dryRun = false } = {}) {
    this.events.push(
      "registry:copy:" + source + "->" + target + (dryRun ? ":dry-run" : ""),
    );
    const pinnedDigest = validateDigest(
      source.split("@").at(-1),
      "Fixture source digest",
    );
    const resultDigest =
      pinnedDigest === APPROVED_DIGEST ? this.promotionDigest : pinnedDigest;
    if (!dryRun) this.prodAliasDigest = resultDigest;
    return { plannedDigest: pinnedDigest };
  }
}

export class FixtureRuntime {
  constructor({ identity, replicas = "1/1" }, events = []) {
    this.identity = identity;
    this.replicas = replicas;
    this.events = events;
  }

  async recover() {
    this.events.push("runtime:recover");
  }

  async snapshot() {
    this.events.push("runtime:snapshot");
    return { identity: this.identity, replicas: this.replicas };
  }
}

export async function promoteProd({
  registry,
  approvedDigest,
  expectedPreviousDigest,
  previousRuntimeIdentity,
  previousRuntimeReplicas,
  execute = false,
  capturedAt = new Date().toISOString(),
  persistReceipt = async () => {},
}) {
  validateDigest(approvedDigest, "Approved digest");
  if (approvedDigest !== APPROVED_DIGEST) {
    fail(
      "Approved digest is not the repository-pinned NOW-255 digest " +
        APPROVED_DIGEST +
        ".",
    );
  }
  validateDigest(expectedPreviousDigest, "Expected previous PROD digest");
  const runtimeDigest = digestFromRuntimeIdentity(previousRuntimeIdentity);
  validateReplicas(previousRuntimeReplicas);
  assertDigestEqual(
    runtimeDigest,
    expectedPreviousDigest,
    "Captured runtime digest",
  );

  const immutableSource = sourceRef(approvedDigest);
  const resolvedSourceDigest = await registry.resolve(immutableSource);
  assertDigestEqual(
    resolvedSourceDigest,
    approvedDigest,
    "Resolved source digest",
  );
  const previousAliasDigest = await registry.resolve(PROD_ALIAS);
  assertDigestEqual(
    previousAliasDigest,
    expectedPreviousDigest,
    "Existing PROD alias digest",
  );

  const receipt = {
    schemaVersion: 1,
    redacted: true,
    fixture: registry.kind === "fixture",
    capturedAt,
    phase: "preflight-captured",
    outcome: "pending",
    image: IMAGE_NAME,
    approvedSource: {
      ref: immutableSource,
      requestedDigest: approvedDigest,
      resolvedDigest: resolvedSourceDigest,
    },
    before: {
      prodAlias: PROD_ALIAS,
      prodAliasDigest: previousAliasDigest,
      runtimeIdentity: previousRuntimeIdentity,
      runtimeReplicas: previousRuntimeReplicas,
    },
    after: null,
    rollbackOrder: ROLLBACK_ORDER,
  };
  await persistReceipt(receipt);

  const copyResult = await registry.copy(immutableSource, PROD_ALIAS, {
    dryRun: !execute,
  });
  assertDigestEqual(
    copyResult.plannedDigest,
    approvedDigest,
    "Planned manifest digest",
  );

  if (!execute) {
    receipt.phase = "dry-run-verified";
    receipt.outcome = "no-mutation";
    receipt.after = { plannedProdAliasDigest: copyResult.plannedDigest };
    await persistReceipt(receipt);
    return receipt;
  }

  try {
    const promotedAliasDigest = await registry.resolve(PROD_ALIAS);
    assertDigestEqual(
      promotedAliasDigest,
      approvedDigest,
      "Promoted PROD alias digest",
    );
    receipt.phase = "promotion-verified";
    receipt.outcome = registry.kind === "fixture" ? "fixture-pass" : "promoted";
    receipt.after = { prodAliasDigest: promotedAliasDigest };
    await persistReceipt(receipt);
    return receipt;
  } catch (promotionError) {
    receipt.phase = "postcondition-failed";
    receipt.outcome = "failed";
    receipt.failure = promotionError.message;
    try {
      await registry.copy(sourceRef(previousAliasDigest), PROD_ALIAS);
      const restoredDigest = await registry.resolve(PROD_ALIAS);
      assertDigestEqual(
        restoredDigest,
        previousAliasDigest,
        "Emergency-restored PROD alias digest",
      );
      receipt.phase = "alias-restored-service-recovery-required";
      receipt.emergencyAliasRestore = { digest: restoredDigest, verified: true };
    } catch (restoreError) {
      receipt.phase = "alias-restore-failed";
      receipt.emergencyAliasRestore = {
        verified: false,
        failure: restoreError.message,
      };
    }
    await persistReceipt(receipt);
    fail(promotionError.message + " Emergency state: " + receipt.phase + ".");
  }
}

export async function rollbackProd({
  registry,
  runtime,
  receipt,
  persistReceipt = async () => {},
}) {
  if (receipt?.schemaVersion !== 1 || receipt?.image !== IMAGE_NAME) {
    fail("Unsupported rollback receipt.");
  }
  const previousDigest = validateDigest(
    receipt.before?.prodAliasDigest,
    "Receipt previous digest",
  );
  const previousRuntimeDigest = digestFromRuntimeIdentity(
    receipt.before?.runtimeIdentity,
  );
  assertDigestEqual(
    previousRuntimeDigest,
    previousDigest,
    "Receipt runtime digest",
  );

  const result = {
    ...receipt,
    rollback: { phase: "started", order: ROLLBACK_ORDER },
  };
  await persistReceipt(result);

  await registry.copy(sourceRef(previousDigest), PROD_ALIAS);
  result.rollback.phase = "alias-restored";
  await persistReceipt(result);

  const restoredAliasDigest = await registry.resolve(PROD_ALIAS);
  assertDigestEqual(
    restoredAliasDigest,
    previousDigest,
    "Restored PROD alias digest",
  );
  result.rollback.phase = "alias-verified";
  await persistReceipt(result);

  await runtime.recover();
  result.rollback.phase = "service-recovered";
  await persistReceipt(result);

  const finalAliasDigest = await registry.resolve(PROD_ALIAS);
  assertDigestEqual(finalAliasDigest, previousDigest, "Final PROD alias digest");
  const runtimeState = await runtime.snapshot();
  const recoveredRuntimeDigest = digestFromRuntimeIdentity(runtimeState.identity);
  assertDigestEqual(
    recoveredRuntimeDigest,
    previousDigest,
    "Recovered runtime digest",
  );
  validateReplicas(runtimeState.replicas);
  result.rollback = {
    phase: "verified",
    order: ROLLBACK_ORDER,
    prodAliasDigest: finalAliasDigest,
    runtimeIdentity: runtimeState.identity,
    runtimeReplicas: runtimeState.replicas,
  };
  await persistReceipt(result);
  return result;
}

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const options = { mode, execute: false };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--execute") {
      options.execute = true;
      continue;
    }
    if (!token.startsWith("--") || index + 1 >= rest.length) {
      fail("Invalid argument " + token + ".");
    }
    options[token.slice(2).replaceAll("-", "_")] = rest[index + 1];
    index += 1;
  }
  return options;
}

async function loadAdapters(fixturePath) {
  if (!fixturePath) {
    return { registry: new DockerRegistry(), runtime: new DockerProdRuntime() };
  }
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  return {
    registry: new FixtureRegistry(fixture),
    runtime: new FixtureRuntime({
      identity: fixture.runtimeIdentity,
      replicas: fixture.runtimeReplicas,
    }),
    capturedAt: fixture.capturedAt,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.receipt) fail("--receipt is required.");
  const adapters = await loadAdapters(options.fixture);
  const persistReceipt = (receipt) => writeReceipt(options.receipt, receipt);

  if (options.mode === "promote") {
    const receipt = await promoteProd({
      registry: adapters.registry,
      approvedDigest: options.approved_digest,
      expectedPreviousDigest: options.expected_previous_digest,
      previousRuntimeIdentity: options.previous_runtime_identity,
      previousRuntimeReplicas: options.previous_runtime_replicas,
      execute: options.execute,
      capturedAt: adapters.capturedAt,
      persistReceipt,
    });
    process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
    return;
  }

  if (options.mode === "rollback") {
    if (!options.execute) fail("Rollback is inert unless --execute is supplied.");
    const receipt = JSON.parse(await readFile(options.receipt, "utf8"));
    const result = await rollbackProd({
      registry: adapters.registry,
      runtime: adapters.runtime,
      receipt,
      persistReceipt,
    });
    process.stdout.write(JSON.stringify(result.rollback, null, 2) + "\n");
    return;
  }

  fail("First argument must be promote or rollback.");
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write("ERROR: " + error.message + "\n");
    process.exitCode = 1;
  });
}
