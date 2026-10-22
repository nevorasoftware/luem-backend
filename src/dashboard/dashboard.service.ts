import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { toCents, centsToDecimal, centsToNumber } from '../common/money';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getMetrics() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const in3Days = new Date(now.getTime() + 3 * 24 * 3600 * 1000);

    // 1. Conteo de vehículos por estado operativo
    const [totalVehicles, operationalVehicles, maintenanceVehicles, inactiveVehicles] =
      await Promise.all([
        this.prisma.vehicle.count({ where: { deletedAt: null } }),
        this.prisma.vehicle.count({ where: { deletedAt: null, operationalStatus: 'OPERATIVO' } }),
        this.prisma.vehicle.count({ where: { deletedAt: null, operationalStatus: 'EN_MANTENIMIENTO' } }),
        this.prisma.vehicle.count({ where: { deletedAt: null, operationalStatus: 'INACTIVO' } }),
      ]);

    // 2. Vehículos actualmente alquilados (con reserva EN_CURSO)
    const rentedVehicles = await this.prisma.reservation.count({
      where: { status: 'EN_CURSO' },
    });

    const availableNow = Math.max(0, operationalVehicles - rentedVehicles);

    // 3. Solicitudes pendientes de revisión
    const pendingRequests = await this.prisma.bookingRequest.count({
      where: { status: 'PENDIENTE_REVISION' },
    });

    const incompleteDocRequests = await this.prisma.bookingRequest.count({
      where: { status: 'DOCUMENTACION_INCOMPLETA' },
    });

    // 4. Reservas próximas (confirmadas o pendientes de pago que inician en los próximos 3 días)
    const upcomingPickups = await this.prisma.reservation.findMany({
      where: {
        status: { in: ['CONFIRMADA', 'PENDIENTE_PAGO'] },
        pickupAt: { gte: now, lte: in3Days },
      },
      include: { customer: true, vehicle: true },
      orderBy: { pickupAt: 'asc' },
      take: 10,
    });

    // 5. Próximas devoluciones (reservas EN_CURSO que vencen pronto)
    const upcomingReturns = await this.prisma.reservation.findMany({
      where: {
        status: 'EN_CURSO',
        returnAt: { lte: in3Days },
      },
      include: { customer: true, vehicle: true },
      orderBy: { returnAt: 'asc' },
      take: 10,
    });

    // 6. Ingresos reales registrados este mes
    const monthlyPayments = await this.prisma.paymentTransaction.findMany({
      where: {
        paidAt: { gte: startOfMonth },
        status: 'REGISTRADO',
      },
      select: { amount: true, type: true },
    });

    let monthlyIncomeCents = 0;
    for (const p of monthlyPayments) {
      const c = toCents(p.amount);
      if (p.type === 'REEMBOLSO') {
        monthlyIncomeCents -= c;
      } else {
        monthlyIncomeCents += c;
      }
    }

    // 7. Saldo pendiente de cobro en reservas activas
    const pendingBalances = await this.prisma.reservation.findMany({
      where: {
        status: { in: ['CONFIRMADA', 'PENDIENTE_PAGO', 'EN_CURSO'] },
        balanceDue: { gt: 0 },
      },
      select: { balanceDue: true },
    });

    let totalPendingBalanceCents = 0;
    for (const b of pendingBalances) {
      totalPendingBalanceCents += toCents(b.balanceDue);
    }

    // 8. Tasa de ocupación de flota
    const occupancyRate =
      totalVehicles > 0 ? Math.round((rentedVehicles / totalVehicles) * 100) : 0;

    const confirmedReservations = await this.prisma.reservation.count({
      where: { status: { in: ['CONFIRMADA', 'PENDIENTE_PAGO'] } },
    });
    const completedThisMonth = await this.prisma.reservation.count({
      where: { status: 'FINALIZADA', returnedAt: { gte: startOfMonth } },
    });

    return {
      fleet: {
        total: totalVehicles,
        available: availableNow,
        rented: rentedVehicles,
        maintenance: maintenanceVehicles,
        inMaintenance: maintenanceVehicles,
        inactive: inactiveVehicles,
        occupancyRate,
      },
      requests: {
        pendingReview: pendingRequests,
        incompleteDocs: incompleteDocRequests,
        totalThisMonth: pendingRequests + incompleteDocRequests,
      },
      reservations: {
        active: rentedVehicles,
        confirmed: confirmedReservations,
        completedThisMonth,
      },
      financials: {
        totalRevenueCents: monthlyIncomeCents,
        pendingBalanceCents: totalPendingBalanceCents,
        thisMonthRevenueCents: monthlyIncomeCents,
      },
      financial: {
        monthlyIncome: centsToDecimal(monthlyIncomeCents),
        monthlyIncomeNum: centsToNumber(monthlyIncomeCents),
        totalPendingBalance: centsToDecimal(totalPendingBalanceCents),
        totalPendingBalanceNum: centsToNumber(totalPendingBalanceCents),
      },
      upcomingPickups: upcomingPickups.map((r) => ({
        id: r.id,
        code: r.code,
        customerName: r.customer.fullName,
        vehicleName: `${r.vehicle.brand} ${r.vehicle.model}`,
        pickupAt: r.pickupAt,
        status: r.status,
      })),
      upcomingReturns: upcomingReturns.map((r) => ({
        id: r.id,
        code: r.code,
        customerName: r.customer.fullName,
        vehicleName: `${r.vehicle.brand} ${r.vehicle.model}`,
        returnAt: r.returnAt,
      })),
    };
  }
}
