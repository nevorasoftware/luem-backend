import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { loadEnv } from '../config/env';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Cada 10 minutos: liberar bloques y solicitudes expiradas.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleExpiredBlocks() {
    const env = loadEnv();
    if (!env.JOBS_ENABLED) return;

    const now = new Date();

    // 1. Desactivar VehicleBlocks con expiresAt vencido
    const expiredBlocks = await this.prisma.vehicleBlock.updateMany({
      where: {
        active: true,
        expiresAt: { lt: now },
      },
      data: { active: false },
    });

    if (expiredBlocks.count > 0) {
      this.logger.log(`Se liberaron ${expiredBlocks.count} bloqueos temporales expirados.`);
    }

    // 2. Marcar solicitudes expiradas
    const expiredRequests = await this.prisma.bookingRequest.updateMany({
      where: {
        status: { in: ['PENDIENTE_REVISION', 'DOCUMENTACION_INCOMPLETA'] },
        expiresAt: { lt: now },
      },
      data: { status: 'EXPIRADA' },
    });

    if (expiredRequests.count > 0) {
      this.logger.log(`Se marcaron ${expiredRequests.count} solicitudes como expiradas.`);
    }
  }

  /**
   * Cada 5 minutos: reintentar correos en estado FALLIDO.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async retryFailedEmails() {
    const env = loadEnv();
    if (!env.JOBS_ENABLED) return;

    const pending = await this.prisma.emailLog.findMany({
      where: {
        status: 'FALLIDO',
        attempts: { lt: 4 },
        nextAttemptAt: { lte: new Date() },
      },
      take: 10,
    });

    for (const email of pending) {
      this.logger.log(`Reintentando envío de correo #${email.id} a ${email.to}`);
      await this.mailService.sendMail({
        to: email.to,
        subject: email.subject,
        template: email.template,
        html: email.html,
        text: email.text,
        requestId: email.requestId || undefined,
      });
    }
  }
}
