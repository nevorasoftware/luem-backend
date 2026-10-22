import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { sha256 } from '../crypto';
import { IS_PUBLIC_KEY } from '../decorators/roles.decorator';
import { SESSION_COOKIE } from '../../config/env';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('No se ha proporcionado sesión de autenticación.');
    }

    const tokenHash = sha256(token);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('La sesión es inválida o ha expirado.');
    }

    if (!session.user.active) {
      throw new UnauthorizedException('La cuenta de usuario está desactivada.');
    }

    // Actualizar lastSeenAt de forma asíncrona
    this.prisma.session
      .update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      })
      .catch(() => null);

    const { passwordHash: _, ...safeUser } = session.user;
    (request as any).user = safeUser;
    (request as any).sessionId = session.id;

    return true;
  }

  private extractToken(request: Request): string | null {
    if (request.cookies && request.cookies[SESSION_COOKIE]) {
      return request.cookies[SESSION_COOKIE];
    }
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7).trim();
    }
    return null;
  }
}
