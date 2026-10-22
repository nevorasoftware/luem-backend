import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createReadStream, existsSync } from 'fs';
import { Readable } from 'stream';
import { SaveFileInput, StorageDriver } from './storage.interface';
import { loadEnv } from '../config/env';

@Injectable()
export class LocalStorageDriver implements StorageDriver {
  private readonly baseDir: string;

  constructor() {
    const env = loadEnv();
    this.baseDir = path.resolve(process.cwd(), env.LOCAL_STORAGE_DIR);
    this.ensureDir(this.baseDir);
  }

  private async ensureDir(dir: string) {
    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  private resolvePath(key: string): string {
    return path.join(this.baseDir, key);
  }

  async save(input: SaveFileInput): Promise<void> {
    const target = this.resolvePath(input.key);
    await this.ensureDir(path.dirname(target));
    await fs.writeFile(target, input.buffer);
  }

  async getStream(key: string): Promise<Readable> {
    const target = this.resolvePath(key);
    if (!existsSync(target)) {
      throw new NotFoundException('Archivo no encontrado en el almacenamiento.');
    }
    return createReadStream(target);
  }

  async getBuffer(key: string): Promise<Buffer> {
    const target = this.resolvePath(key);
    if (!existsSync(target)) {
      throw new NotFoundException('Archivo no encontrado en el almacenamiento.');
    }
    return fs.readFile(target);
  }

  async delete(key: string): Promise<void> {
    const target = this.resolvePath(key);
    if (existsSync(target)) {
      await fs.unlink(target).catch(() => null);
    }
  }

  async getSignedDownloadUrl(key: string, _expiresInSeconds: number): Promise<string> {
    const env = loadEnv();
    return `${env.FRONTEND_URL}/api/storage/file/${encodeURIComponent(key)}`;
  }
}
