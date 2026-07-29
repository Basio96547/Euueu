import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { assertNoPublishedDemoInProd } from './common/boot-guard.js';

const PORT = Number(process.env.API_PORT ?? 4000);

async function bootstrap() {
  await assertNoPublishedDemoInProd();
  const app = await NestFactory.create(AppModule, { cors: { origin: true, credentials: true } });
  app.setGlobalPrefix('api/v1');
  await app.listen(PORT, '0.0.0.0');
  console.log(`API على http://localhost:${PORT}/api/v1`);
}
bootstrap();
