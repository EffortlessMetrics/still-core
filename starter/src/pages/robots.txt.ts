import type { APIContext } from 'astro';
export function GET({ site }: APIContext) {
  const production = import.meta.env.PUBLIC_SITE_ENV === 'production';
  const origin = site?.origin ?? 'https://clear-current.example';
  const text = production
    ? `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n';
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
