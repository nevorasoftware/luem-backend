import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { loadEnv } from '../config/env';
import { formatUSD } from '../common/money';
import { formatDateTime } from '../common/dates';

export interface SendMailOptions {
  to: string;
  subject: string;
  template: string;
  html: string;
  text: string;
  requestId?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly prisma: PrismaService) {
    const env = loadEnv();
    if (env.MAIL_DRIVER === 'smtp' && env.SMTP_HOST) {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER && env.SMTP_PASS ? {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        } : undefined,
      });
    }
  }

  async sendMail(options: SendMailOptions): Promise<void> {
    const env = loadEnv();

    // Guardar siempre el intento en email_logs
    const emailLog = await this.prisma.emailLog.create({
      data: {
        to: options.to,
        subject: options.subject,
        template: options.template,
        html: options.html,
        text: options.text,
        requestId: options.requestId,
        status: 'PENDIENTE',
      },
    });

    try {
      if (env.MAIL_DRIVER === 'smtp' && this.transporter) {
        await this.transporter.sendMail({
          from: env.MAIL_FROM,
          to: options.to,
          subject: options.subject,
          text: options.text,
          html: options.html,
        });
      } else if (env.MAIL_DRIVER === 'resend' && env.RESEND_API_KEY) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: env.MAIL_FROM,
            to: options.to,
            subject: options.subject,
            html: options.html,
            text: options.text,
          }),
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Error en API de Resend: ${res.status} - ${errText}`);
        }
      } else {
        // Modo 'console' (para desarrollo y pruebas locales)
        this.logger.log(`\n================= [CORREO SIMULADO] =================\nPara: ${options.to}\nAsunto: ${options.subject}\n\n${options.text}\n======================================================\n`);
      }

      await this.prisma.emailLog.update({
        where: { id: emailLog.id },
        data: {
          status: 'ENVIADO',
          sentAt: new Date(),
          attempts: { increment: 1 },
        },
      });
    } catch (err: any) {
      this.logger.error(`Fallo al enviar correo a ${options.to}: ${err.message}`);
      await this.prisma.emailLog.update({
        where: { id: emailLog.id },
        data: {
          status: 'FALLIDO',
          attempts: { increment: 1 },
          lastError: String(err?.message || err).slice(0, 500),
          nextAttemptAt: new Date(Date.now() + 5 * 60 * 1000), // Reintento en 5 min
        },
      });
    }
  }

  // --- Plantillas estilizadas ---

  renderBaseHtml(title: string, contentHtml: string): string {
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F4F6F8; margin: 0; padding: 24px; color: #1E293B; }
    .container { max-width: 600px; margin: 0 auto; background: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(11, 18, 32, 0.08); border: 1px solid #E2E8F0; }
    .header { background: #0B1220; padding: 32px 28px; text-align: center; border-bottom: 3px solid #299BEB; }
    .header h1 { margin: 0; color: #FFFFFF; font-size: 24px; letter-spacing: 2px; font-weight: 800; }
    .header p { margin: 6px 0 0; color: #C7D0DA; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; }
    .content { padding: 32px 28px; line-height: 1.6; }
    .footer { background: #F8FAFC; padding: 20px 28px; text-align: center; font-size: 12px; color: #64748B; border-top: 1px solid #E2E8F0; }
    .btn { display: inline-block; background: #1769AA; color: #FFFFFF !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; margin-top: 16px; font-size: 14px; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; background: #EFF6FF; color: #1769AA; border: 1px solid #BFDBFE; }
    .card { background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #E2E8F0; font-size: 14px; }
    .row:last-child { border-bottom: none; font-weight: 700; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>LUEM</h1>
      <p>Rent a Car • El Salvador</p>
    </div>
    <div class="content">
      ${contentHtml}
    </div>
    <div class="footer">
      <p>LUEM RENT A CAR — Servicio de alquiler de vehículos premium en El Salvador.</p>
      <p>Este es un correo automático. Por favor no responda directamente a esta dirección.</p>
    </div>
  </div>
</body>
</html>`;
  }

  async sendRequestReceived(params: {
    to: string;
    customerName: string;
    requestCode: string;
    vehicleName: string;
    pickupAt: Date;
    returnAt: Date;
    trackingUrl: string;
    requestId: string;
  }) {
    const title = `Solicitud Recibida — ${params.requestCode}`;
    const html = this.renderBaseHtml(
      title,
      `<h2>¡Hola, ${params.customerName}!</h2>
      <p>Hemos recibido correctamente su solicitud de reserva para el vehículo <strong>${params.vehicleName}</strong>.</p>
      <div class="card">
        <p style="margin:0 0 8px;"><strong>Código de solicitud:</strong> <span class="badge">${params.requestCode}</span></p>
        <p style="margin:4px 0;"><strong>Fecha de recogida:</strong> ${formatDateTime(params.pickupAt)}</p>
        <p style="margin:4px 0;"><strong>Fecha de devolución:</strong> ${formatDateTime(params.returnAt)}</p>
        <p style="margin:4px 0;"><strong>Estado actual:</strong> <span style="color:#D97706; font-weight:bold;">PENDIENTE DE REVISIÓN</span></p>
      </div>
      <p>Nuestro equipo revisará la documentación ingresada y la disponibilidad operativa del vehículo. <strong>Este correo no constituye una confirmación definitiva del alquiler.</strong></p>
      <p>Puede consultar en tiempo real el avance de su solicitud haciendo clic en el siguiente botón:</p>
      <p style="text-align: center;"><a href="${params.trackingUrl}" class="btn">Consultar Estado de mi Solicitud</a></p>
      <p style="font-size:12px; color:#64748B;">O copie este enlace seguro en su navegador:<br/><code>${params.trackingUrl}</code></p>`,
    );

    const text = `LUEM RENT A CAR\n\n¡Hola, ${params.customerName}!\n\nHemos recibido su solicitud de reserva (${params.requestCode}) para el vehículo ${params.vehicleName}.\nRecogida: ${formatDateTime(params.pickupAt)}\nDevolución: ${formatDateTime(params.returnAt)}\nEstado: Pendiente de revisión.\n\nEste correo no constituye confirmación definitiva del alquiler.\nPuede consultar el avance de su solicitud en: ${params.trackingUrl}\n`;

    await this.sendMail({
      to: params.to,
      subject: `Solicitud de reserva recibida — ${params.requestCode} | LUEM`,
      template: 'request_received',
      html,
      text,
      requestId: params.requestId,
    });
  }

  async sendBookingApproved(params: {
    to: string;
    customerName: string;
    reservationCode: string;
    vehicleName: string;
    pickupAt: Date;
    returnAt: Date;
    pickupLocation: string;
    returnLocation: string;
    dailyRateCents: number;
    billableDays: number;
    totalCents: number;
    depositRequiredCents?: number;
    balanceDueCents: number;
    paymentInstructions: string;
    trackingUrl: string;
    requestId: string;
  }) {
    const title = `¡Reserva Aprobada! — ${params.reservationCode}`;
    const html = this.renderBaseHtml(
      title,
      `<h2>¡Buenas noticias, ${params.customerName}!</h2>
      <p>Su solicitud ha sido <strong>APROBADA</strong> por nuestro equipo y se ha asignado satisfactoriamente el vehículo.</p>
      <div class="card">
        <p style="margin:0 0 12px;"><strong>Código de Reserva:</strong> <span class="badge">${params.reservationCode}</span></p>
        <p style="margin:4px 0;"><strong>Vehículo Asignado:</strong> ${params.vehicleName}</p>
        <p style="margin:4px 0;"><strong>Lugar y Fecha de Recogida:</strong> ${params.pickupLocation} — ${formatDateTime(params.pickupAt)}</p>
        <p style="margin:4px 0;"><strong>Lugar y Fecha de Devolución:</strong> ${params.returnLocation} — ${formatDateTime(params.returnAt)}</p>
        <hr style="border:0; border-top:1px solid #CBD5E1; margin:12px 0;"/>
        <div class="row"><span>Tarifa diaria (${params.billableDays} días):</span><span>${formatUSD(params.dailyRateCents)}</span></div>
        <div class="row"><span>Total a pagar:</span><span>${formatUSD(params.totalCents)}</span></div>
        ${params.depositRequiredCents ? `<div class="row"><span>Depósito de garantía:</span><span>${formatUSD(params.depositRequiredCents)}</span></div>` : ''}
        <div class="row" style="color:#0F172A; font-size:16px;"><span>Saldo pendiente:</span><span style="color:#1769AA;">${formatUSD(params.balanceDueCents)}</span></div>
      </div>
      <h3>Instrucciones para el pago</h3>
      <div style="background:#F1F5F9; border-left:4px solid #1769AA; padding:12px; font-size:14px; white-space:pre-wrap;">${params.paymentInstructions || 'Por favor consulte los métodos autorizados mediante nuestro canal de atención.'}</div>
      <p style="margin-top:20px; text-align: center;"><a href="${params.trackingUrl}" class="btn">Ver Mi Reserva e Instrucciones</a></p>`,
    );

    const text = `LUEM RENT A CAR\n\n¡Buenas noticias, ${params.customerName}!\n\nSu reserva (${params.reservationCode}) ha sido APROBADA.\nVehículo: ${params.vehicleName}\nRecogida: ${params.pickupLocation} (${formatDateTime(params.pickupAt)})\nDevolución: ${params.returnLocation} (${formatDateTime(params.returnAt)})\nTotal a pagar: ${formatUSD(params.totalCents)}\nSaldo pendiente: ${formatUSD(params.balanceDueCents)}\n\nInstrucciones de pago:\n${params.paymentInstructions}\n\nEnlace seguro: ${params.trackingUrl}\n`;

    await this.sendMail({
      to: params.to,
      subject: `¡Reserva Aprobada! — ${params.reservationCode} | LUEM`,
      template: 'booking_approved',
      html,
      text,
      requestId: params.requestId,
    });
  }

  async sendRequestRejected(params: {
    to: string;
    customerName: string;
    requestCode: string;
    reason: string;
    requestId: string;
  }) {
    const title = `Estado de su solicitud — ${params.requestCode}`;
    const html = this.renderBaseHtml(
      title,
      `<h2>Estimado/a ${params.customerName},</h2>
      <p>Lamentamos informarle que su solicitud <strong>${params.requestCode}</strong> no pudo ser aprobada en esta ocasión.</p>
      <div class="card" style="border-left:4px solid #EF4444;">
        <p style="margin:0;"><strong>Motivo:</strong> ${params.reason || 'No se cumplieron los criterios de validación operativa o documental requeridos.'}</p>
      </div>
      <p>Si considera que se trata de un error o desea explorar otras opciones de vehículos o fechas, no dude en comunicarse con nosotros.</p>`,
    );

    const text = `LUEM RENT A CAR\n\nEstimado/a ${params.customerName},\nSu solicitud ${params.requestCode} no pudo ser aprobada.\nMotivo: ${params.reason}\n`;

    await this.sendMail({
      to: params.to,
      subject: `Actualización de su solicitud — ${params.requestCode} | LUEM`,
      template: 'request_rejected',
      html,
      text,
      requestId: params.requestId,
    });
  }

  async sendInfoRequired(params: {
    to: string;
    customerName: string;
    requestCode: string;
    message: string;
    trackingUrl: string;
    requestId: string;
  }) {
    const title = `Documentación requerida — ${params.requestCode}`;
    const html = this.renderBaseHtml(
      title,
      `<h2>Hola, ${params.customerName},</h2>
      <p>Nuestro equipo ha revisado su solicitud <strong>${params.requestCode}</strong> y requiere que actualice o proporcione información adicional para continuar con el proceso:</p>
      <div class="card" style="border-left:4px solid #F59E0B;">
        <p style="margin:0; font-weight:600;">Detalle de la solicitud:</p>
        <p style="margin:8px 0 0;">${params.message}</p>
      </div>
      <p>Por favor ingrese al siguiente enlace para adjuntar los documentos solicitados de forma segura:</p>
      <p style="text-align: center;"><a href="${params.trackingUrl}" class="btn">Subir Documentos</a></p>`,
    );

    const text = `LUEM RENT A CAR\n\nHola, ${params.customerName},\nSe requiere información adicional para su solicitud ${params.requestCode}:\n${params.message}\n\nIngrese en: ${params.trackingUrl}\n`;

    await this.sendMail({
      to: params.to,
      subject: `Información requerida para su solicitud — ${params.requestCode} | LUEM`,
      template: 'info_required',
      html,
      text,
      requestId: params.requestId,
    });
  }
}
