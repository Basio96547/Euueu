import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { existsSync, mkdirSync } from 'node:fs';
import { AppModule } from './app.module.js';
import { assertNoPublishedDemoInProd } from './common/boot-guard.js';
import { mediaPublicBase, mediaRoot, usesLocalDisk } from './modules/storage.js';
import { initKv } from './common/kv.js';

const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 4000);

async function bootstrap() {
  await assertNoPublishedDemoInProd();
  await initKv();
  const app = await NestFactory.create(AppModule, { cors: { origin: true, credentials: true } });

  /* الصور تصل كـ data URL داخل JSON، وحدّ Express الافتراضي 100 كيلوبايت
     يرفض أي صورة جوال. الحدّ هنا يوازي MEDIA_MAX_BYTES مع هامش الترميز
     (base64 يزيد الحجم الثلث). */
  app.use(json({ limit: process.env.JSON_BODY_LIMIT ?? '6mb' }));

  app.setGlobalPrefix('api/v1');

  if (usesLocalDisk) {
    if (!existsSync(mediaRoot)) mkdirSync(mediaRoot, { recursive: true });
    // الصور تُخدَم من خارج البادئة api/v1: روابطها تُحفظ في القاعدة وتبقى ثابتة
    const { default: express } = await import('express');
    app.use(mediaPublicBase, express.static(mediaRoot, { maxAge: '30d', immutable: true }));
  }

  await app.listen(PORT, '0.0.0.0');
  console.log(`API على http://localhost:${PORT}/api/v1`);
  if (usesLocalDisk) {
    console.log(`الصور على القرص: ${mediaRoot} — لنسخة خادم واحدة فقط.`);
    console.log('عند تشغيل أكثر من نسخة اضبط S3_ENDPOINT وإلا لم ترَ كل نسخة صور الأخرى.');
  }
}
bootstrap();
