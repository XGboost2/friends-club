import { readFile } from "node:fs/promises";
import { query, CLUB_TZ } from "./db.js";

const site = JSON.parse(await readFile(new URL("../shared/site.json", import.meta.url), "utf8"));

export const SITE_URL = (process.env.SITE_URL || "https://friends-club.cz").replace(/\/+$/, "");
const OG_IMAGE = `${SITE_URL}/og-image.png`;

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
// JSON inside <script> must not be able to close the tag.
const jsonLd = (data) => JSON.stringify(data).replace(/</g, "\\u003c");

/** Pages players can land on. Everything else is either private (noindex) or a 404. */
const PAGES = {
  "/": { title: site.title, description: site.description, index: true },
  "/my-sessions": { title: "My sessions — Friends Club", description: "Your upcoming Friends Club badminton sessions.", index: false },
  "/admin/login": { title: "Admin — Friends Club", description: "Friends Club admin sign-in.", index: false },
  "/admin/polls": { title: "Polls — Friends Club admin", description: "Manage badminton polls.", index: false },
  "/admin/checkin": { title: "Check-in — Friends Club admin", description: "Multisport check-in.", index: false },
  "/admin/records": { title: "Records — Friends Club admin", description: "Session records.", index: false },
  "/admin": { title: "Admin — Friends Club", description: "Friends Club admin.", index: false },
};

export function pageFor(path) {
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return PAGES[clean] ? { path: clean, ...PAGES[clean], status: 200 } : { path: clean, title: "Page not found — Friends Club", description: site.description, index: false, status: 404 };
}

async function upcomingSessions() {
  try {
    const { rows } = await query(
      `SELECT s.id, s.date, s.start_time, s.end_time, s.venue, s.capacity, s.court_numbers,
         to_char(((s.date::text || ' ' || s.start_time)::timestamp AT TIME ZONE $1) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_iso,
         to_char(((s.date::text || ' ' || s.end_time)::timestamp AT TIME ZONE $1) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS end_iso,
         to_char(s.date, 'Dy DD Mon YYYY') AS label,
         (SELECT count(*) FROM registrations r WHERE r.session_id = s.id) +
         (SELECT count(*) FROM guests g JOIN registrations r ON r.id = g.registration_id WHERE r.session_id = s.id) AS taken
       FROM sessions s
       WHERE s.status = 'open' AND s.date >= current_date
       ORDER BY s.date, s.start_time LIMIT 20`,
      [CLUB_TZ],
    );
    return rows;
  } catch (error) {
    console.error("SEO: could not load sessions", error.message);
    return [];
  }
}

function structuredData(sessions) {
  const org = {
    "@type": "SportsOrganization",
    "@id": `${SITE_URL}/#club`,
    name: site.name,
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/icon-512.png`,
    image: OG_IMAGE,
    description: site.description,
    sport: "Badminton",
    areaServed: { "@type": "City", name: "Prague" },
    address: { "@type": "PostalAddress", addressLocality: "Prague", addressCountry: "CZ" },
  };
  const graph = [
    org,
    { "@type": "WebSite", "@id": `${SITE_URL}/#website`, url: `${SITE_URL}/`, name: site.name, inLanguage: "en", publisher: { "@id": `${SITE_URL}/#club` } },
    {
      "@type": "FAQPage",
      "@id": `${SITE_URL}/#faq`,
      mainEntity: site.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
    ...sessions.map((s) => ({
      "@type": "SportsEvent",
      name: `Friends Club badminton — ${s.label}`,
      description: `Badminton session at ${s.venue}, Prague. All levels welcome.`,
      sport: "Badminton",
      startDate: s.start_iso,
      endDate: s.end_iso,
      eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      url: `${SITE_URL}/`,
      image: OG_IMAGE,
      location: { "@type": "Place", name: s.venue, address: { "@type": "PostalAddress", addressLocality: "Prague", addressCountry: "CZ" } },
      organizer: { "@id": `${SITE_URL}/#club` },
      maximumAttendeeCapacity: s.capacity,
      remainingAttendeeCapacity: Math.max(0, s.capacity - Number(s.taken)),
    })),
  ];
  return { "@context": "https://schema.org", "@graph": graph };
}

/**
 * Plain HTML version of the homepage for crawlers and link previews. It mirrors
 * what the app shows (hero, upcoming sessions, how it works, FAQ) and is replaced
 * by the React app as soon as the JavaScript loads.
 */
function homeFallback(sessions) {
  const list = sessions.length
    ? `<ul>${sessions
        .map((s) => `<li><strong>${esc(s.label)}</strong>, ${esc(s.start_time)}–${esc(s.end_time)} · ${esc(s.venue)} · ${Math.max(0, s.capacity - Number(s.taken))} spots left</li>`)
        .join("")}</ul>`
    : `<p>New sessions are posted regularly — check back soon.</p>`;
  return `<div class="seo-fallback">
<header><a href="/">friends<b>club</b>.</a></header>
<main>
<p>${esc(site.tagline)}</p>
<h1>Book your court. Bring the smash.</h1>
<p>${esc(site.description)}</p>
<h2>Upcoming badminton sessions in Prague</h2>
${list}
<h2>How it works</h2>
<ol>${site.steps.map((s) => `<li><strong>${esc(s.title)}.</strong> ${esc(s.text)}</li>`).join("")}</ol>
<h2>Frequently asked questions</h2>
${site.faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join("")}
<p><a href="/">Open the Friends Club calendar</a></p>
</main>
</div>`;
}

export async function renderPage(template, path) {
  const page = pageFor(path);
  const canonical = `${SITE_URL}${page.path === "/" ? "/" : page.path}`;
  const sessions = page.path === "/" ? await upcomingSessions() : [];
  const verification = process.env.GOOGLE_SITE_VERIFICATION ? `<meta name="google-site-verification" content="${esc(process.env.GOOGLE_SITE_VERIFICATION)}" />` : "";
  const head = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}" />`,
    `<meta name="robots" content="${page.index ? "index, follow, max-image-preview:large" : "noindex, nofollow"}" />`,
    page.index ? `<link rel="canonical" href="${canonical}" />` : "",
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(site.name)}" />`,
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:url" content="${canonical}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="Friends Club — badminton sessions in Prague" />`,
    `<meta property="og:locale" content="en_GB" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(page.title)}" />`,
    `<meta name="twitter:description" content="${esc(page.description)}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
    verification,
    page.path === "/" ? `<script type="application/ld+json">${jsonLd(structuredData(sessions))}</script>` : "",
  ]
    .filter(Boolean)
    .join("\n    ");
  const html = template
    .replace(/<title>[\s\S]*?<\/title>/, "")
    .replace(/<meta name="description"[^>]*>/, "")
    .replace("<!--seo-head-->", head)
    .replace("<!--app-html-->", page.path === "/" ? homeFallback(sessions) : "");
  return { html, status: page.status, index: page.index };
}

export function robotsTxt() {
  return `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/
Disallow: /my-sessions

Sitemap: ${SITE_URL}/sitemap.xml
`;
}

export async function sitemapXml() {
  let lastmod = new Date().toISOString().slice(0, 10);
  try {
    const { rows } = await query(`SELECT to_char(max(created_at), 'YYYY-MM-DD') AS d FROM sessions`);
    if (rows[0]?.d) lastmod = rows[0].d;
  } catch {
    /* keep today */
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
}
