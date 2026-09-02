import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const COUNT_START = "<!-- PROTOTYPE_COUNT_START -->";
const COUNT_END = "<!-- PROTOTYPE_COUNT_END -->";
const CARDS_START = "<!-- PROTOTYPE_CARDS_START -->";
const CARDS_END = "<!-- PROTOTYPE_CARDS_END -->";
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function assertCard(card, slug) {
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`Prototype directory has an invalid slug: ${slug}`);
  }

  for (const field of ["title", "kicker", "description"]) {
    if (typeof card[field] !== "string" || card[field].trim() === "") {
      throw new Error(`${slug}/card.json requires a non-empty ${field}.`);
    }
  }

  if (!Number.isInteger(card.order) || card.order < 1) {
    throw new Error(`${slug}/card.json requires a positive integer order.`);
  }

  if (
    !Array.isArray(card.features) ||
    card.features.length === 0 ||
    card.features.some(
      (feature) => typeof feature !== "string" || feature.trim() === "",
    )
  ) {
    throw new Error(`${slug}/card.json requires non-empty feature labels.`);
  }
}

export async function readPrototypeCards(prototypesRoot) {
  const directories = (
    await readdir(prototypesRoot, { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));

  const cards = await Promise.all(
    directories.map(async (directory) => {
      const source = await readFile(
        resolve(prototypesRoot, directory.name, "card.json"),
        "utf8",
      );
      const card = JSON.parse(source);
      assertCard(card, directory.name);
      return Object.freeze({ ...card, slug: directory.name });
    }),
  );

  const orders = new Set();
  for (const card of cards) {
    if (orders.has(card.order)) {
      throw new Error(`Prototype card order ${card.order} is duplicated.`);
    }
    orders.add(card.order);
  }

  return cards.sort(
    (left, right) =>
      left.order - right.order || left.slug.localeCompare(right.slug),
  );
}

function renderCard(card, index) {
  const features = card.features
    .map((feature) => `              <li>${escapeHtml(feature)}</li>`)
    .join("\n");
  const cardNumber = String(index + 1).padStart(2, "0");

  return `        <article class="prototype-card">
          <div class="card-preview" aria-hidden="true">
            <span class="preview-orbit preview-orbit-one"></span>
            <span class="preview-orbit preview-orbit-two"></span>
            <span class="preview-dot"></span>
            <span class="preview-label">GAME / ${cardNumber}</span>
          </div>
          <div class="card-content">
            <p class="card-kicker">${escapeHtml(card.kicker)}</p>
            <h3>${escapeHtml(card.title)}</h3>
            <p>${escapeHtml(card.description)}</p>
            <ul class="feature-list" aria-label="Game features">
${features}
            </ul>
            <a class="play-link" href="./prototypes/${escapeHtml(card.slug)}/">
              Play now <span aria-hidden="true">&rarr;</span>
            </a>
          </div>
        </article>`;
}

function replaceRegion(source, start, end, content) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Hub template is missing registry marker ${start}.`);
  }

  return `${source.slice(0, startIndex)}${start}\n${content}\n          ${source.slice(endIndex)}`;
}

export function populateHub(template, cards) {
  const count = cards.length;
  const countLabel = `${count} game${count === 1 ? "" : "s"}`;
  const countMarkup = `          <span class="count" data-prototype-count aria-label="${countLabel}"
            >${String(count).padStart(2, "0")}</span
          >`;
  const cardsMarkup =
    count === 0
      ? '          <p class="empty-state">No games live yet.</p>'
      : cards.map(renderCard).join("\n");

  return replaceRegion(
    replaceRegion(template, COUNT_START, COUNT_END, countMarkup),
    CARDS_START,
    CARDS_END,
    cardsMarkup,
  );
}
