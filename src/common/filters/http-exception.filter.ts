import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Error interno del servidor';
    let code = 'INTERNAL_SERVER_ERROR';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const body = res as Record<string, any>;
        message = body.message || message;
        code = body.error || code;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002': {
          status = HttpStatus.CONFLICT;
          const target = (exception.meta?.target as string[])?.join(', ') || 'campo único';
          message = `Ya existe un registro con el mismo valor para: ${target}.`;
          code = 'DUPLICATE_KEY';
          break;
        }
        case 'P2025': {
          status = HttpStatus.NOT_FOUND;
          message = 'El recurso solicitado no fue encontrado.';
          code = 'NOT_FOUND';
          break;
        }
        case 'P2003': {
          status = HttpStatus.BAD_REQUEST;
          message = 'La operación viola una restricción de clave foránea o relación.';
          code = 'FOREIGN_KEY_VIOLATION';
          break;
        }
        default: {
          status = HttpStatus.BAD_REQUEST;
          message = 'Error en la base de datos al procesar la solicitud.';
          code = `PRISMA_${exception.code}`;
        }
      }
    } else if (exception instanceof Error) {
      this.logger.error(`Excepción no controlada en ${request.method} ${request.url}: ${exception.message}`, exception.stack);
    }

    response.status(status).json({
      statusCode: status,
      error: code,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
