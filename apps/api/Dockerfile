# صورة الواجهة البرمجية — بناء متعدد المراحل
#
# المرحلتان مقصودتان: أدوات البناء (TypeScript وPrisma CLI ومصادر الحزم)
# تبقى في الأولى ولا تصل الإنتاج. صورةٌ تحمل مترجمها تحمل معه ثغراته.

# ─────────── البناء ───────────
FROM node:22-alpine AS build
WORKDIR /repo

RUN corepack enable

# التبعيات أولاً وحدها: تغيير سطر في الشيفرة لا يُعيد تنزيلها
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY packages packages
COPY apps/api apps/api
COPY seed seed

RUN pnpm --filter @talisham/api exec prisma generate \
 && pnpm --filter @talisham/api run build

# حزم الإنتاج وحدها في شجرة نظيفة
RUN pnpm --filter @talisham/api deploy --prod --legacy /out \
 && cp -r apps/api/dist /out/dist \
 && cp -r apps/api/prisma /out/prisma

# ─────────── التشغيل ───────────
FROM node:22-alpine AS runtime
WORKDIR /app

# لا يعمل بـroot: ثغرةٌ في التطبيق تصير ثغرة في المضيف
RUN addgroup -g 1001 app && adduser -u 1001 -G app -s /bin/sh -D app

# openssl يلزم عميل Prisma على alpine، وtini يجعل الإشارات تصل
RUN apk add --no-cache openssl tini

COPY --from=build --chown=app:app /out /app

# مجلد الصور: يُركَّب كحجم دائم وإلا ضاعت الصور مع كل نشر
RUN mkdir -p /app/media && chown app:app /app/media
VOLUME ["/app/media"]

USER app
ENV NODE_ENV=production PORT=4000 MEDIA_DIR=/app/media
EXPOSE 4000

# فحص الصحة يقرأ مساراً حقيقياً: صورةٌ «صحيحة» لا تردّ ليست صحيحة
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
# الهجرات تُطبَّق عند الإقلاع: نشرٌ بشيفرة جديدة وقاعدة قديمة يفشل بأخطاء غامضة
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node dist/main.js"]
