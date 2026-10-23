import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { Public, Roles } from '../common/decorators/roles.decorator';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@Controller('settings')
@UseGuards(AuthGuard, RolesGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Public()
  @Get('public')
  async getPublicSettings() {
    return this.settingsService.getPublicSettings();
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Get()
  async getSettings() {
    return this.settingsService.getAllSettingsAdmin();
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Get('admin')
  async getAllAdmin() {
    return this.settingsService.getAllSettingsAdmin();
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Put()
  async updateSettings(
    @Body() body: any,
    @CurrentUser('id') adminId: string,
    @CurrentUser('fullName') adminName: string,
  ) {
    return this.settingsService.updateGeneralSettings(body, adminId, adminName || 'Admin');
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Put('admin')
  async updateSettingsAlias(
    @Body() body: any,
    @CurrentUser('id') adminId: string,
    @CurrentUser('fullName') adminName: string,
  ) {
    return this.settingsService.updateGeneralSettings(body, adminId, adminName || 'Admin');
  }

  @Roles(UserRole.ADMIN, UserRole.OPERADOR)
  @Put('admin/:key')
  async updateSetting(
    @Param('key') key: string,
    @Body('value') value: any,
    @CurrentUser('id') adminId: string,
    @CurrentUser('fullName') adminName: string,
  ) {
    return this.settingsService.updateSetting(key, value, adminId, adminName || 'Admin');
  }
}
