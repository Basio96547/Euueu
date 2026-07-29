/**
 * robots.txt — بند الجاهزية 15.
 * ما يُمنع زحفه ليس سرّاً بل ما لا معنى لفهرسته: تطبيق السلة والحساب
 * صفحاتٌ خلف تسجيل دخول ونتيجتها في نتائج البحث صفحة فارغة تُسيء للموقع.
 */
import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const base = (site?.href ?? 'https://talisham.com/').replace(/\/$/, '');

  const body = `User-agent: *
Allow: /
Disallow: /app/
Disallow: /courier/
Disallow: /admin/
Disallow: /*?q=

Sitemap: ${base}/sitemap.xml
`;

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
