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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
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
  @Get('extras')
  async getExtras() {
    return this.fleetService.listExtras();
  }

  @Public()
  @Post('quote')
  async calculateQuote(@Body() body: any) {
    const p = body.pickupAt || body.pickupDate;
    const r = body.returnAt || body.returnDate;

    let extras = body.extras;
    if (!extras && Array.isArray(body.extraIds)) {
      extras = body.extraIds.map((id: string) => ({ extraId: id, quantity: 1 }));
    }

    const input: QuoteInput = {
      vehicleId: body.vehicleId,
      pickupAt: p ? new Date(p) : new Date(),
      returnAt: r ? new Date(r) : new Date(),
      pickupLocationId:
        body.pickupLocationId ||
        (typeof body.pickupLocation === 'string' && body.pickupLocation.length === 36
          ? body.pickupLocation
          : undefined),
      returnLocationId:
        body.returnLocationId ||
        (typeof body.returnLocation === 'string' && body.returnLocation.length === 36
          ? body.returnLocation
          : undefined),
      extras,
      discountCode: body.discountCode,
    };

    const quote = await this.pricingService.calculateQuote(input);

    return {
      ...quote,
      rentalDays: quote.billableDays,
      dailyRate: quote.dailyRateCents,
      daysSubtotal: quote.baseAmountCents,
      volumeDiscountAmount: quote.discountTotalCents,
      promoDiscountAmount: 0,
      extrasTotal: quote.extrasTotalCents,
      locationFee: quote.feesTotalCents,
      subtotal:
        quote.baseAmountCents +
        quote.extrasTotalCents +
        quote.feesTotalCents -
        quote.discountTotalCents,
      taxAmount: quote.taxTotalCents,
      total: quote.totalCents,
      securityDeposit: quote.depositRequiredCents,
    };
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

  // --- Endpoints de Gestión de Categorías ---

  @Roles(UserRole.ADMIN)
  @Post('admin/categories')
  async createCategory(@CurrentUser('id') adminId: string, @Body() body: any) {
    return this.fleetService.createCategory(body, adminId);
  }

  @Roles(UserRole.ADMIN)
  @Put('admin/categories/:id')
  async updateCategory(
    @CurrentUser('id') adminId: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.fleetService.updateCategory(id, body, adminId);
  }

  @Roles(UserRole.ADMIN)
  @Delete('admin/categories/:id')
  async deleteCategory(@CurrentUser('id') adminId: string, @Param('id') id: string) {
    return this.fleetService.deleteCategory(id, adminId);
  }

  // --- Endpoints de Gestión de Fotos de Vehículos ---

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Get('admin/vehicles/:id/photos')
  async getPhotos(@Param('id') vehicleId: string) {
    return this.fleetService.getVehiclePhotos(vehicleId);
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Get('vehicles/:id/photos')
  async getPhotosAlias(@Param('id') vehicleId: string) {
    return this.fleetService.getVehiclePhotos(vehicleId);
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Post('admin/vehicles/:id/photos')
  @UseInterceptors(FileInterceptor('file'))
  async uploadPhoto(
    @Param('id') vehicleId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('alt') alt?: string,
    @Body('isCover') isCover?: string,
  ) {
    return this.fleetService.addVehiclePhoto(vehicleId, file, alt, isCover === 'true' || isCover === '1');
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Post('vehicles/:id/photos')
  @UseInterceptors(FileInterceptor('file'))
  async uploadPhotoAlias(
    @Param('id') vehicleId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('alt') alt?: string,
    @Body('isCover') isCover?: string,
  ) {
    return this.fleetService.addVehiclePhoto(vehicleId, file, alt, isCover === 'true' || isCover === '1');
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Post('admin/vehicles/:id/photos/bulk')
  @UseInterceptors(FilesInterceptor('files', 20))
  async uploadPhotosBulk(
    @Param('id') vehicleId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('coverIndex') coverIndex?: string,
  ) {
    const idx = coverIndex !== undefined ? parseInt(coverIndex, 10) : undefined;
    return this.fleetService.addVehiclePhotosBulk(vehicleId, files, isNaN(idx!) ? undefined : idx);
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Post('vehicles/:id/photos/bulk')
  @UseInterceptors(FilesInterceptor('files', 20))
  async uploadPhotosBulkAlias(
    @Param('id') vehicleId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body('coverIndex') coverIndex?: string,
  ) {
    const idx = coverIndex !== undefined ? parseInt(coverIndex, 10) : undefined;
    return this.fleetService.addVehiclePhotosBulk(vehicleId, files, isNaN(idx!) ? undefined : idx);
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Put('admin/vehicles/:id/photos/:photoId/cover')
  async setCoverPhoto(
    @Param('id') vehicleId: string,
    @Param('photoId') photoId: string,
  ) {
    return this.fleetService.setVehicleCoverPhoto(vehicleId, photoId);
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Put('vehicles/:id/photos/:photoId/cover')
  async setCoverPhotoAlias(
    @Param('id') vehicleId: string,
    @Param('photoId') photoId: string,
  ) {
    return this.fleetService.setVehicleCoverPhoto(vehicleId, photoId);
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Delete('admin/photos/:id')
  async deletePhoto(@Param('id') photoId: string) {
    return this.fleetService.deleteVehiclePhoto(photoId);
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Delete('photos/:id')
  async deletePhotoAlias(@Param('id') photoId: string) {
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

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Put('vehicles/:id/photos/reorder')
  async reorderPhotosAlias(
    @Param('id') vehicleId: string,
    @Body('photoIds') photoIds: string[],
  ) {
    return this.fleetService.reorderVehiclePhotos(vehicleId, photoIds);
  }
}
