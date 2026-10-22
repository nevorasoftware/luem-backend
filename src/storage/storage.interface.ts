import { Readable } from 'stream';

export interface SaveFileInput {
  key: string;
  buffer: Buffer;
  mimeType: string;
  visibility: 'PUBLIC' | 'PRIVATE';
}

export interface StorageDriver {
  save(input: SaveFileInput): Promise<void>;
  getStream(key: string): Promise<Readable>;
  getBuffer(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  getSignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
}
