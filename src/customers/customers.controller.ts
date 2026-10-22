import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
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
  @Post()
  async create(
    @CurrentUser('id') adminId: string,
    @Body() body: any,
  ) {
    return this.customersService.createCustomer(body, adminId);
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

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Post(':id/block')
  async toggleBlock(
    @CurrentUser('id') adminId: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const isBlocked = body.isBlocked !== undefined ? body.isBlocked : body.blocked;
    const blockReason = body.blockReason || body.blockedReason;
    return this.customersService.updateCustomer(
      id,
      { blocked: Boolean(isBlocked), blockedReason: blockReason },
      adminId,
    );
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  async delete(
    @CurrentUser('id') adminId: string,
    @Param('id') id: string,
  ) {
    return this.customersService.deleteCustomer(id, adminId);
  }
}
