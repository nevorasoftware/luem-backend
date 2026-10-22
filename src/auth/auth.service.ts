import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  hashPassword,
  verifyPassword,
  randomToken,
  sha256,
  passwordPolicyError,
} from '../common/crypto';
import { loadEnv } from '../config/env';
import { AuditService } from '../audit/audit.service';

export interface LoginResult {
  token: string;
  expiresAt: Date;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async login(
    email: string,
    pass: string,
    ip?: string,
    userAgent?: string,
  ): Promise<LoginResult> {
    const cleanEmail = (email || '').trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: cleanEmail } });

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    if (!user.active) {
      throw new UnauthorizedException('Su cuenta de usuario ha sido desactivada.');
    }

    // Comprobación de bloqueo por intentos fallidos
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const waitMin = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new ForbiddenException(
        `Cuenta bloqueada temporalmente por intentos fallidos. Intente de nuevo en ${waitMin} minutos.`,
      );
    }

    const isValid = await verifyPassword(pass, user.passwordHash);
    if (!isValid) {
      const newAttempts = user.failedLoginAttempts + 1;
      const shouldLock = newAttempts >= 5;
      const lockedUntil = shouldLock ? new Date(Date.now() + 15 * 60 * 1000) : null;

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: shouldLock ? 0 : newAttempts,
          lockedUntil,
        },
      });

      throw new UnauthorizedException('Credenciales inválidas.');
    }

    // Resetear contador de fallos y actualizar último login
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    const env = loadEnv();
    const rawToken = randomToken(32);
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600 * 1000);

    await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        ip,
        userAgent,
      },
    });

    await this.audit.log({
      actorType: 'USUARIO',
      actorUserId: user.id,
      actorName: user.fullName,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      summary: `Inicio de sesión exitoso para ${user.email}`,
      ip,
    });

    return {
      token: rawToken,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    };
  }

  async logout(sessionId: string, userId?: string, ip?: string): Promise<void> {
    if (sessionId) {
      await this.prisma.session.update({
        where: { id: sessionId },
        data: { revokedAt: new Date() },
      }).catch(() => null);
    }

    if (userId) {
      await this.audit.log({
        actorType: 'USUARIO',
        actorUserId: userId,
        action: 'LOGOUT',
        entityType: 'Session',
        entityId: sessionId,
        summary: 'Cierre de sesión',
        ip,
      });
    }
  }

  async changePassword(userId: string, currentPass: string, newPass: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const ok = await verifyPassword(currentPass, user.passwordHash);
    if (!ok) {
      throw new BadRequestException('La contraseña actual es incorrecta.');
    }

    const policyErr = passwordPolicyError(newPass);
    if (policyErr) {
      throw new BadRequestException(policyErr);
    }

    const newHash = await hashPassword(newPass);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    // Revocar todas las demás sesiones por seguridad
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { message: 'Contraseña actualizada correctamente.' };
  }

  // --- CRUD de usuarios (ADMIN) ---

  async listUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        active: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { fullName: 'asc' },
    });
  }

  async createUser(data: { email: string; fullName: string; role: UserRole; password: string }, adminId: string) {
    const policyErr = passwordPolicyError(data.password);
    if (policyErr) throw new BadRequestException(policyErr);

    const email = data.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('Ya existe un usuario registrado con este correo.');
    }

    const passwordHash = await hashPassword(data.password);
    const created = await this.prisma.user.create({
      data: {
        email,
        fullName: data.fullName.trim(),
        role: data.role,
        passwordHash,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        active: true,
        createdAt: true,
      },
    });

    await this.audit.log({
      actorType: 'USUARIO',
      actorUserId: adminId,
      action: 'CREATE_USER',
      entityType: 'User',
      entityId: created.id,
      summary: `Usuario ${created.email} creado con rol ${created.role}`,
    });

    return created;
  }

  async updateUser(
    id: string,
    data: { fullName?: string; role?: UserRole; active?: boolean; newPassword?: string },
    adminId: string,
  ) {
    const updateData: any = {};
    if (data.fullName) updateData.fullName = data.fullName.trim();
    if (data.role) updateData.role = data.role;
    if (typeof data.active === 'boolean') updateData.active = data.active;
    if (data.newPassword) {
      const err = passwordPolicyError(data.newPassword);
      if (err) throw new BadRequestException(err);
      updateData.passwordHash = await hashPassword(data.newPassword);
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        active: true,
      },
    });

    await this.audit.log({
      actorType: 'USUARIO',
      actorUserId: adminId,
      action: 'UPDATE_USER',
      entityType: 'User',
      entityId: id,
      summary: `Usuario ${updated.email} actualizado`,
    });

    return updated;
  }
}
