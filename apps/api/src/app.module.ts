import { Module } from '@nestjs/common';
import { PrismaService } from './common/prisma.service.js';
import { HealthController } from './modules/health.controller.js';
import { FxController, FxService } from './modules/fx.module.js';
import { CatalogController, CatalogService } from './modules/catalog.module.js';
import { CartController, CartService } from './modules/cart.module.js';
import { OrdersController, OrdersService } from './modules/orders.module.js';
import { AdminController } from './modules/admin.module.js';
import { CourierController } from './modules/courier.module.js';
import { NotificationsService } from './modules/notifications.service.js';

@Module({
  controllers: [
    HealthController, FxController, CatalogController,
    CartController, OrdersController, AdminController, CourierController,
  ],
  providers: [PrismaService, FxService, CatalogService, CartService, OrdersService, NotificationsService],
})
export class AppModule {}
