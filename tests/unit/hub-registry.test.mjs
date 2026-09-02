import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  populateHub,
  readPrototypeCards,
} from "../../scripts/hub-registry.mjs";

const scratchRoot =
  process.env.PAPERCLIP_RUN_SCRATCH_DIR ??
  process.env.PAPERCLIP_SCRATCH_DIR ??
  tmpdir();
const template = `<!doctype html>
<!-- PROTOTYPE_COUNT_START -->
old count
<!-- PROTOTYPE_COUNT_END -->
<!-- PROTOTYPE_CARDS_START -->
old cards
<!-- PROTOTYPE_CARDS_END -->`;

test("directory cards are ordered, escaped, counted, and linked", async (t) => {
  await mkdir(scratchRoot, { recursive: true });
  const root = await mkdtemp(join(scratchRoot, "nownow-registry-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const fixtures = [
    {
      slug: "safe-passage",
      card: {
        order: 2,
        title: "Safe <Passage>",
        kicker: "Quick & careful",
        description: "A deterministic route.",
        features: ["Touch + keyboard"],
      },
    },
    {
      slug: "before-midnight",
      card: {
        order: 1,
        title: "Before Midnight",
        kicker: "Beat the clock",
        description: "A deterministic dash.",
        features: ["Retry"],
      },
    },
  ];

  for (const fixture of fixtures) {
    const directory = join(root, fixture.slug);
    await mkdir(directory);
    await writeFile(join(directory, "card.json"), JSON.stringify(fixture.card));
  }

  const cards = await readPrototypeCards(root);
  assert.deepEqual(
    cards.map((card) => card.slug),
    ["before-midnight", "safe-passage"],
  );

  const hub = populateHub(template, cards);
  assert.match(hub, /aria-label="2 games"/);
  assert.match(hub, />02<\/span/);
  assert.match(hub, /\.\/prototypes\/before-midnight\//);
  assert.match(hub, /GAME \/ 01/);
  assert.match(hub, /Play now/);
  assert.match(hub, /Safe &lt;Passage&gt;/);
  assert.doesNotMatch(hub, /Safe <Passage>/);
  assert.ok(hub.indexOf("Before Midnight") < hub.indexOf("Safe &lt;Passage&gt;"));
});
