import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';
import { STORAGE_DRIVER_TOKEN } from './storage.constants';
import { LocalStorageDriver } from './local-storage.driver';
import { S3StorageDriver } from './s3-storage.driver';
import { loadEnv } from '../config/env';

@Global()
@Module({
  controllers: [StorageController],
  providers: [
    StorageService,
    {
      provide: STORAGE_DRIVER_TOKEN,
      useFactory: () => {
        const env = loadEnv();
        return env.STORAGE_DRIVER === 's3'
          ? new S3StorageDriver()
          : new LocalStorageDriver();
      },
    },
  ],
  exports: [StorageService, STORAGE_DRIVER_TOKEN],
})
export class StorageModule {}
