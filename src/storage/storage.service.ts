import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FileVisibility } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as path from 'path';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { sha256 } from '../common/crypto';
import { StorageDriver } from './storage.interface';
import { STORAGE_DRIVER_TOKEN } from './storage.constants';

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

export interface UploadOptions {
  visibility: FileVisibility;
  uploadedByUserId?: string;
  optimizeImage?: boolean;
}

@Injectable()
export class StorageService {
  constructor(
    @Inject(STORAGE_DRIVER_TOKEN) private readonly driver: StorageDriver,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Valida magic bytes del archivo para garantizar que el tipo real coincide con
   * un archivo seguro (evitando ejecutables disfrazados de PNG/JPG/PDF).
   */
  private detectAndValidateMime(buffer: Buffer, declaredMime: string): string {
    if (buffer.length < 4) {
      throw new BadRequestException('El archivo subido está corrupto o vacío.');
    }

    // JPEG: FF D8 FF
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    // PNG: 89 50 4E 47
    const isPng =
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47;
    // PDF: %PDF (25 50 44 46)
    const isPdf =
      buffer[0] === 0x25 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x44 &&
      buffer[3] === 0x46;
    // WEBP: 'RIFF'....'WEBP'
    const isWebp =
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP';

    let detected: string | null = null;
    if (isJpeg) detected = 'image/jpeg';
    else if (isPng) detected = 'image/png';
    else if (isPdf) detected = 'application/pdf';
    else if (isWebp) detected = 'image/webp';

    if (!detected || !ALLOWED_MIME_TYPES.includes(detected)) {
      throw new BadRequestException(
        'Tipo de archivo no permitido. Solo se admiten JPG, PNG, WEBP o PDF reales.',
      );
    }

    return detected;
  }

  async uploadFile(
    file: Express.Multer.File,
    options: UploadOptions,
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException('No se ha recibido ningún archivo.');
    }

    const validatedMime = this.detectAndValidateMime(file.buffer, file.mimetype);

    let finalBuffer = file.buffer;
    let width: number | null = null;
    let height: number | null = null;

    if (validatedMime.startsWith('image/') && options.optimizeImage !== false) {
      try {
        const metadata = await sharp(file.buffer).metadata();
        width = metadata.width || null;
        height = metadata.height || null;

        // Si la imagen es muy grande, redimensionarla manteniendo aspect ratio
        if ((width && width > 2400) || (height && height > 2400)) {
          finalBuffer = await sharp(file.buffer)
            .resize(2400, 2400, { fit: 'inside', withoutEnlargement: true })
            .toBuffer();
          const newMeta = await sharp(finalBuffer).metadata();
          width = newMeta.width || width;
          height = newMeta.height || height;
        }
      } catch (err) {
        throw new BadRequestException('La imagen proporcionada no es válida.');
      }
    }

    const ext = path.extname(file.originalname) || (validatedMime === 'application/pdf' ? '.pdf' : '.jpg');
    const folder = options.visibility === 'PUBLIC' ? 'public' : 'private';
    const key = `${folder}/${new Date().getFullYear()}/${randomUUID()}${ext}`;
    const hash = sha256(finalBuffer);

    await this.driver.save({
      key,
      buffer: finalBuffer,
      mimeType: validatedMime,
      visibility: options.visibility,
    });

    const storedFile = await this.prisma.storedFile.create({
      data: {
        storageKey: key,
        visibility: options.visibility,
        mimeType: validatedMime,
        sizeBytes: finalBuffer.length,
        sha256: hash,
        originalName: path.basename(file.originalname).slice(0, 200),
        width,
        height,
        uploadedByUserId: options.uploadedByUserId,
      },
    });

    return storedFile;
  }

  async getFileStream(fileId: string) {
    const file = await this.prisma.storedFile.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException('Archivo no encontrado.');
    const stream = await this.driver.getStream(file.storageKey);
    return { file, stream };
  }

  async getFileBuffer(fileId: string) {
    const file = await this.prisma.storedFile.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException('Archivo no encontrado.');
    const buffer = await this.driver.getBuffer(file.storageKey);
    return { file, buffer };
  }

  async getSignedUrl(fileId: string, expiresInSeconds = 900) {
    const file = await this.prisma.storedFile.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException('Archivo no encontrado.');
    return this.driver.getSignedDownloadUrl(file.storageKey, expiresInSeconds);
  }
}
