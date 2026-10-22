import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { Public, Roles } from '../common/decorators/roles.decorator';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { loadEnv, SESSION_COOKIE } from '../config/env';
import { UserRole } from '@prisma/client';

@Controller('auth')
@UseGuards(AuthGuard, RolesGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(
    @Body() body: { email: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const result = await this.authService.login(body.email, body.password, ip, userAgent);

    const env = loadEnv();
    res.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'lax',
      expires: result.expiresAt,
      path: '/',
    });

    return {
      user: result.user,
      token: result.token,
      expiresAt: result.expiresAt,
    };
  }

  @Post('logout')
  async logout(
    @Req() req: Request,
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const sessionId = (req as any).sessionId;
    const ip = req.ip || req.socket.remoteAddress;
    await this.authService.logout(sessionId, userId, ip);

    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { success: true, message: 'Sesión cerrada correctamente.' };
  }

  @Get('me')
  async me(@CurrentUser() user: any) {
    return { user };
  }

  @Post('change-password')
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() body: { currentPassword: string; newPassword: string },
  ) {
    return this.authService.changePassword(userId, body.currentPassword, body.newPassword);
  }

  // --- Endpoints exclusivos para ADMIN ---

  @Roles(UserRole.ADMIN)
  @Get('users')
  async listUsers() {
    return this.authService.listUsers();
  }

  @Roles(UserRole.ADMIN)
  @Post('users')
  async createUser(
    @CurrentUser('id') adminId: string,
    @Body() body: { email: string; fullName: string; role: UserRole; password: string },
  ) {
    return this.authService.createUser(body, adminId);
  }

  @Roles(UserRole.ADMIN)
  @Put('users/:id')
  async updateUser(
    @CurrentUser('id') adminId: string,
    @Param('id') id: string,
    @Body() body: { fullName?: string; role?: UserRole; active?: boolean; newPassword?: string },
  ) {
    return this.authService.updateUser(id, body, adminId);
  }
}
