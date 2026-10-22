import { Module } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';
import { CustomersModule } from '../customers/customers.module';
import { FleetModule } from '../fleet/fleet.module';

@Module({
  imports: [CustomersModule, FleetModule],
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
