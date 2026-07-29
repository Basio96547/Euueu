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
import { SearchController, SearchService } from './modules/search.module.js';
import { WarrantyController, WarrantyService } from './modules/warranty.module.js';
import { ProcurementController, ProcurementService } from './modules/procurement.module.js';

@Module({
  controllers: [
    HealthController, FxController, CatalogController,
    CartController, OrdersController, AdminController, CourierController,
    SearchController, WarrantyController, ProcurementController,
  ],
  providers: [
    PrismaService, FxService, CatalogService, CartService, OrdersService,
    NotificationsService, SearchService, WarrantyService, ProcurementService,
  ],
})
export class AppModule {}
