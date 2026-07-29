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
import { SettlementsController, SettlementsService } from './modules/settlements.module.js';
import { ReturnsController, ReturnsService } from './modules/returns.module.js';
import { CouponsController, CouponsService } from './modules/coupons.module.js';
import { ReviewsController, ReviewsService } from './modules/reviews.module.js';
import { TicketsController, TicketsService } from './modules/tickets.module.js';
import { AlertsController, AlertsService } from './modules/alerts.module.js';
import { ProductsAdminController, ProductsAdminService } from './modules/products.admin.js';
import { PushController, PushService } from './modules/push.module.js';

@Module({
  controllers: [
    HealthController, FxController, CatalogController,
    CartController, OrdersController, AdminController, CourierController,
    SearchController, WarrantyController, ProcurementController, AuthController,
    SettlementsController, ReturnsController, CouponsController,
    ReviewsController, TicketsController, AlertsController, ProductsAdminController,
    PushController,
  ],
  providers: [
    PrismaService, FxService, CatalogService, CartService, OrdersService,
    NotificationsService, SearchService, WarrantyService, ProcurementService, AuthService,
    ReservationSweeper,
    SettlementsService, ReturnsService, CouponsService,
    ReviewsService, TicketsService, AlertsService, ProductsAdminService, PushService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RateLimitMiddleware).forRoutes('*');
  }
}
