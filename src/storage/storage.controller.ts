import {
  Controller,
  Get,
  Param,
  Res,
  Query,
  UnauthorizedException,
  ForbiddenException,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { StorageService } from './storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/roles.decorator';
import { AuthGuard } from '../common/guards/auth.guard';
import { sha256 } from '../common/crypto';

@Controller('storage')
export class StorageController {
  constructor(
    private readonly storageService: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('public/:fileId')
  async getPublicFile(@Param('fileId') fileId: string, @Res() res: Response) {
    const { file, stream } = await this.storageService.getFileStream(fileId);
    if (file.visibility !== 'PUBLIC') {
      throw new ForbiddenException('Este archivo es de acceso privado.');
    }

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.sizeBytes);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    stream.pipe(res);
  }

  @UseGuards(AuthGuard)
  @Get('private/:fileId')
  async getPrivateFile(@Param('fileId') fileId: string, @Res() res: Response) {
    const { file, stream } = await this.storageService.getFileStream(fileId);

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.sizeBytes);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName)}"`);
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    stream.pipe(res);
  }

  /**
   * Permite al cliente que subió sus documentos verlos en su pantalla de seguimiento
   * siempre que proporcione el access token válido de su solicitud.
   */
  @Public()
  @Get('token/:requestId/:fileId')
  async getFileWithAccessToken(
    @Param('requestId') requestId: string,
    @Param('fileId') fileId: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    if (!token) {
      throw new UnauthorizedException('Token de acceso obligatorio.');
    }

    const tokenHash = sha256(token);
    const validToken = await this.prisma.accessToken.findFirst({
      where: {
        requestId,
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!validToken) {
      throw new UnauthorizedException('Token de acceso inválido o expirado.');
    }

    // Verificar que el archivo pertenece a la solicitud
    const doc = await this.prisma.customerDocument.findFirst({
      where: { requestId, fileId },
    });

    if (!doc) {
      throw new ForbiddenException('El archivo no está asociado a esta solicitud.');
    }

    const { file, stream } = await this.storageService.getFileStream(fileId);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.sizeBytes);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName)}"`);
    res.setHeader('Cache-Control', 'private, no-cache, no-store');
    stream.pipe(res);
  }
}
