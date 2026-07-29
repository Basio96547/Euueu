/**
 * خريطة الموقع — بند الجاهزية 15 (الفصل 19 §19.5).
 * تُولَّد وقت البناء من المصادر نفسها التي تولّد الصفحات، فلا تكذب
 * خريطةٌ على محرك بحث بصفحةٍ لم تُبنَ ولا تُخفي صفحةً بُنيت.
 */
import type { APIRoute } from 'astro';
import { products, categories, brandList } from '../lib/catalog';
import { ARTICLES } from '../lib/help';
import { POSTS } from '../lib/blog';
import { LEGAL } from '../lib/legal';

type Entry = { loc: string; priority: string; changefreq: string; lastmod?: string };

export const GET: APIRoute = ({ site }) => {
  const base = (site?.href ?? 'https://talisham.com/').replace(/\/$/, '');

  const entries: Entry[] = [
    { loc: '/', priority: '1.0', changefreq: 'daily' },
    { loc: '/search/', priority: '0.6', changefreq: 'weekly' },
    { loc: '/compare/', priority: '0.4', changefreq: 'monthly' },
    { loc: '/help/', priority: '0.7', changefreq: 'monthly' },
    { loc: '/blog/', priority: '0.7', changefreq: 'weekly' },
    ...categories.map((c) => ({ loc: `/c/${c.slug}/`, priority: '0.9', changefreq: 'daily' })),
    ...brandList.map((b) => ({ loc: `/b/${b.slug}/`, priority: '0.8', changefreq: 'weekly' })),
    ...products.map((p) => ({ loc: `/p/${p.slug}/`, priority: '0.8', changefreq: 'daily' })),
    ...ARTICLES.map((a) => ({ loc: `/help/${a.slug}/`, priority: '0.6', changefreq: 'monthly' })),
    ...POSTS.map((p) => ({
      loc: `/blog/${p.slug}/`, priority: '0.6', changefreq: 'monthly', lastmod: p.published,
    })),
    ...LEGAL.map((d) => ({
      loc: `/legal/${d.slug}/`, priority: '0.4', changefreq: 'yearly', lastmod: d.updated,
    })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (e) => `  <url>
    <loc>${base}${e.loc}</loc>${e.lastmod ? `\n    <lastmod>${e.lastmod}</lastmod>` : ''}
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`,
  )
  .join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
