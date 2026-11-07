import type { APIRoute } from 'astro';
export const prerender = true;
// /api/ is the app's own data feed: of no use to search engines, and a request can reach the data providers.
// /vetr/ is not listed: it asks for a password and sends noindex, which crawlers must be able to see.
export const GET: APIRoute = ({ site }) => new Response(
  `User-agent: *\nDisallow: /api/\n\nSitemap: ${new URL('sitemap-index.xml', site).href}\n`,
  { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
