import { Injectable } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorType: ActorType;
  actorUserId?: string;
  actorName?: string;
  action: string;
  entityType: string;
  entityId?: string;
  summary: string;
  metadata?: any;
  ip?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorType: entry.actorType,
          actorUserId: entry.actorUserId,
          actorName: entry.actorName,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          summary: entry.summary,
          metadata: entry.metadata ?? undefined,
          ip: entry.ip,
        },
      });
    } catch {
      // No fallar la transacción principal si la auditoría falla
    }
  }
}
