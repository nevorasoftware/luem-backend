import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FleetService, VehicleFilterQuery } from './fleet.service';
import { PricingService, QuoteInput } from '../pricing/pricing.service';
import { Public, Roles } from '../common/decorators/roles.decorator';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('fleet')
@UseGuards(AuthGuard, RolesGuard)
export class FleetController {
  constructor(
    private readonly fleetService: FleetService,
    private readonly pricingService: PricingService,
  ) {}

  // --- Endpoints Públicos ---

  @Public()
  @Get('vehicles')
  async getPublicVehicles(
    @Query('categoryId') categoryId?: string,
    @Query('vehicleType') vehicleType?: string,
    @Query('transmission') transmission?: string,
    @Query('passengers') passengers?: number,
    @Query('pickupAt') pickupAt?: string,
    @Query('returnAt') returnAt?: string,
    @Query('search') search?: string,
  ) {
    const query: VehicleFilterQuery = {
      categoryId,
      vehicleType,
      transmission,
      passengers: passengers ? Number(passengers) : undefined,
      pickupAt: pickupAt ? new Date(pickupAt) : undefined,
      returnAt: returnAt ? new Date(returnAt) : undefined,
      search,
    };
    return this.fleetService.getPublicVehicles(query);
  }

  @Public()
  @Get('vehicles/slug/:slug')
  async getVehicleBySlug(@Param('slug') slug: string) {
    return this.fleetService.getPublicVehicleBySlug(slug);
  }

  @Public()
  @Get('categories')
  async getCategories() {
    return this.fleetService.listCategories();
  }

  @Public()
  @Get('features')
  async getFeatures() {
    return this.fleetService.listFeatures();
  }

  @Public()
  @Get('locations')
  async getLocations() {
    return this.fleetService.listLocations();
  }

  @Public()
  @Post('quote')
  async calculateQuote(@Body() body: any) {
    const input: QuoteInput = {
      vehicleId: body.vehicleId,
      pickupAt: new Date(body.pickupAt),
      returnAt: new Date(body.returnAt),
      pickupLocationId: body.pickupLocationId,
      returnLocationId: body.returnLocationId,
      extras: body.extras,
      discountCode: body.discountCode,
    };
    return this.pricingService.calculateQuote(input);
  }

  // --- Endpoints Administrativos ---

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Get('admin/vehicles')
  async listAdminVehicles() {
    return this.fleetService.listVehiclesAdmin();
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Get('admin/vehicles/:id')
  async getAdminVehicle(@Param('id') id: string) {
    return this.fleetService.getVehicleAdmin(id);
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/vehicles')
  async createVehicle(@CurrentUser('id') adminId: string, @Body() body: any) {
    return this.fleetService.createVehicle(body, adminId);
  }

  @Roles(UserRole.ADMIN)
  @Put('admin/vehicles/:id')
  async updateVehicle(
    @CurrentUser('id') adminId: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.fleetService.updateVehicle(id, body, adminId);
  }

  @Roles(UserRole.ADMIN)
  @Delete('admin/vehicles/:id')
  async deleteVehicle(@CurrentUser('id') adminId: string, @Param('id') id: string) {
    return this.fleetService.deleteVehicle(id, adminId);
  }

  // Aliases para máxima compatibilidad con frontend (/api/fleet/vehicles)
  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Post('vehicles')
  async createVehicleAlias(@CurrentUser('id') adminId: string, @Body() body: any) {
    return this.fleetService.createVehicle(body, adminId);
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Put('vehicles/:id')
  async updateVehicleAlias(
    @CurrentUser('id') adminId: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.fleetService.updateVehicle(id, body, adminId);
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Patch('vehicles/:id')
  async patchVehicleAlias(
    @CurrentUser('id') adminId: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.fleetService.updateVehicle(id, body, adminId);
  }

  @Roles(UserRole.ADMIN)
  @Delete('vehicles/:id')
  async deleteVehicleAlias(@CurrentUser('id') adminId: string, @Param('id') id: string) {
    return this.fleetService.deleteVehicle(id, adminId);
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Post('admin/vehicles/:id/photos')
  @UseInterceptors(FileInterceptor('file'))
  async uploadPhoto(
    @Param('id') vehicleId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('alt') alt?: string,
  ) {
    return this.fleetService.addVehiclePhoto(vehicleId, file, alt);
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Delete('admin/photos/:id')
  async deletePhoto(@Param('id') photoId: string) {
    return this.fleetService.deleteVehiclePhoto(photoId);
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Put('admin/vehicles/:id/photos/reorder')
  async reorderPhotos(
    @Param('id') vehicleId: string,
    @Body('photoIds') photoIds: string[],
  ) {
    return this.fleetService.reorderVehiclePhotos(vehicleId, photoIds);
  }
}
