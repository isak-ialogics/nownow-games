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
        pageTitle: "Safe Passage | Test",
        pageDescription: "A deterministic route.",
        socialImage: "safe-passage-share.png",
        socialImageAlt: "Safe Passage fixture",
        features: ["Touch + keyboard"],
      },
    },
    {
      slug: "before-midnight",
      card: {
        order: 1,
        publicPath: "games/before-midnight",
        title: "Before Midnight",
        kicker: "Beat the clock",
        description: "A deterministic dash.",
        pageTitle: "Before Midnight | Test",
        pageDescription: "A deterministic dash.",
        socialImage: "before-midnight-share.png",
        socialImageAlt: "Before Midnight fixture",
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
  assert.match(hub, /\.\/games\/before-midnight\//);
  assert.match(hub, /\.\/prototypes\/safe-passage\//);
  assert.match(hub, /Play now/);
  assert.match(hub, /Safe &lt;Passage&gt;/);
  assert.doesNotMatch(hub, /Safe <Passage>/);
  assert.ok(hub.indexOf("Before Midnight") < hub.indexOf("Safe &lt;Passage&gt;"));
});

test("unsafe public paths are rejected", async (t) => {
  await mkdir(scratchRoot, { recursive: true });
  const root = await mkdtemp(join(scratchRoot, "nownow-registry-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const directory = join(root, "before-midnight");
  await mkdir(directory);
  await writeFile(
    join(directory, "card.json"),
    JSON.stringify({
      order: 1,
      publicPath: "../outside",
      title: "Before Midnight",
      kicker: "Beat the clock",
      description: "A deterministic dash.",
      pageTitle: "Before Midnight | Test",
      pageDescription: "A deterministic dash.",
      socialImage: "before-midnight-share.png",
      socialImageAlt: "Before Midnight fixture",
      features: ["Retry"],
    }),
  );

  await assert.rejects(readPrototypeCards(root), /invalid publicPath/);
});
