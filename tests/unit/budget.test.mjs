import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = resolve(import.meta.dirname, "..", "..", "scripts", "check-budget.mjs");
const scratchRoot =
  process.env.PAPERCLIP_RUN_SCRATCH_DIR ??
  process.env.PAPERCLIP_SCRATCH_DIR ??
  tmpdir();

function runBudget(root) {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, NOWNOW_BUDGET_ROOT: root },
  });
}

test("budget accepts exact limits and rejects a synthetic JS breach", async (t) => {
  await mkdir(scratchRoot, { recursive: true });
  const root = await mkdtemp(join(scratchRoot, "nownow-budget-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  await mkdir(join(root, "shared"), { recursive: true });
  await mkdir(join(root, "prototypes", "synthetic"), { recursive: true });
  await writeFile(join(root, "index.html"), Buffer.alloc(7 * 1024));
  await writeFile(join(root, "shared", "input.js"), Buffer.alloc(7 * 1024));
  await writeFile(join(root, "shared", "site.css"), Buffer.alloc(7 * 1024));
  await writeFile(
    join(root, "prototypes", "synthetic", "game.js"),
    Buffer.alloc(8.5 * 1024),
  );
  await writeFile(
    join(root, "prototypes", "synthetic", "index.html"),
    Buffer.alloc(11.5 * 1024),
  );

  const atLimit = runBudget(root);
  assert.equal(atLimit.status, 0, atLimit.stderr);
  assert.match(atLimit.stdout, /PASS hub\/index\.html/);
  assert.match(atLimit.stdout, /PASS prototypes\/synthetic/);

  await writeFile(
    join(root, "prototypes", "synthetic", "game.js"),
    Buffer.alloc(8.5 * 1024 + 1),
  );
  await writeFile(
    join(root, "prototypes", "synthetic", "index.html"),
    Buffer.alloc(11.5 * 1024 - 1),
  );

  const overLimit = runBudget(root);
  assert.equal(overLimit.status, 1);
  assert.match(overLimit.stdout, /FAIL prototypes\/synthetic/);
  assert.match(overLimit.stderr, /performance budget exceeded/i);
});

function deterministicNoise(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let state = 0x2135eed;
  let value = "";
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    value += alphabet[state >>> 27];
  }
  return value;
}

test("budget rejects a route whose combined game and shared wire JS exceeds the limit", async (t) => {
  await mkdir(scratchRoot, { recursive: true });
  const root = await mkdtemp(join(scratchRoot, "nownow-route-budget-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  await mkdir(join(root, "shared"), { recursive: true });
  await mkdir(join(root, "prototypes", "synthetic"), { recursive: true });
  await writeFile(join(root, "index.html"), "<!doctype html><title>Hub</title>");
  await writeFile(
    join(root, "prototypes", "synthetic", "index.html"),
    '<!doctype html><script type="module" src="./game.js"></script>',
  );
  await writeFile(
    join(root, "prototypes", "synthetic", "game.js"),
    `import "../../shared/input.js";\n${deterministicNoise(7_600)}`,
  );
  await writeFile(
    join(root, "shared", "input.js"),
    deterministicNoise(7_600),
  );

  const result = runBudget(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /PASS prototypes\/synthetic/u);
  assert.match(result.stdout, /FAIL wire\/prototypes\/synthetic/u);
  assert.match(result.stderr, /wire\/prototypes\/synthetic JavaScript/u);
});
