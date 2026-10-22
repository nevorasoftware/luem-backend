import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { MailModule } from './mail/mail.module';
import { PricingModule } from './pricing/pricing.module';
import { AuditModule } from './audit/audit.module';
import { SettingsModule } from './settings/settings.module';
import { AuthModule } from './auth/auth.module';
import { FleetModule } from './fleet/fleet.module';
import { CustomersModule } from './customers/customers.module';
import { RequestsModule } from './requests/requests.module';
import { ReservationsModule } from './reservations/reservations.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    StorageModule,
    MailModule,
    PricingModule,
    AuditModule,
    SettingsModule,
    AuthModule,
    FleetModule,
    CustomersModule,
    RequestsModule,
    ReservationsModule,
    MaintenanceModule,
    DashboardModule,
    TasksModule,
  ],
})
export class AppModule {}
