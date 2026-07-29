import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './common/guards.js';
import { RateLimitMiddleware } from './common/rate-limit.js';
import { AuthController, AuthService } from './modules/auth.module.js';
import { PrismaService } from './common/prisma.service.js';
import { HealthController } from './modules/health.controller.js';
import { FxController, FxService } from './modules/fx.module.js';
import { CatalogController, CatalogService } from './modules/catalog.module.js';
import { CartController, CartService } from './modules/cart.module.js';
import { OrdersController, OrdersService } from './modules/orders.module.js';
import { AdminController } from './modules/admin.module.js';
import { CourierController } from './modules/courier.module.js';
import { NotificationsService } from './modules/notifications.service.js';
import { SearchController, SearchService } from './modules/search.module.js';
import { WarrantyController, WarrantyService } from './modules/warranty.module.js';
import { ProcurementController, ProcurementService } from './modules/procurement.module.js';
import { ReservationSweeper } from './modules/reservations.sweeper.js';

@Module({
  controllers: [
    HealthController, FxController, CatalogController,
    CartController, OrdersController, AdminController, CourierController,
    SearchController, WarrantyController, ProcurementController, AuthController,
  ],
  providers: [
    PrismaService, FxService, CatalogService, CartService, OrdersService,
    NotificationsService, SearchService, WarrantyService, ProcurementService, AuthService,
    ReservationSweeper,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimitMiddleware).forRoutes('*');
  }
}
