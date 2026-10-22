import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('customers')
@UseGuards(AuthGuard, RolesGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Get()
  async list(@Query('search') search?: string) {
    return this.customersService.listCustomers(search);
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Get(':id')
  async getDetails(@Param('id') id: string) {
    return this.customersService.getCustomerDetails(id);
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Put(':id')
  async update(
    @CurrentUser('id') adminId: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.customersService.updateCustomer(id, body, adminId);
  }
}
