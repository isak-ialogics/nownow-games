import { publicPathForCard } from "./hub-registry.mjs";

export const PRODUCTION_ORIGIN = "https://nownowgames.co.za";

function publicUrls(cards) {
  return [
    `${PRODUCTION_ORIGIN}/`,
    ...cards.map((card) => `${PRODUCTION_ORIGIN}/${publicPathForCard(card)}/`),
  ];
}

export function buildSitemap(cards) {
  const entries = publicUrls(cards)
    .map((url) => `  <url><loc>${url}</loc></url>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

export function buildRobots() {
  return `User-agent: *\nAllow: /\nSitemap: ${PRODUCTION_ORIGIN}/sitemap.xml\n`;
}
