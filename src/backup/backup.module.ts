import { Global, Module } from '@nestjs/common';
import { BackupService } from './backup.service';

/** Global: the control panel uses it. */
@Global()
@Module({ providers: [BackupService], exports: [BackupService] })
export class BackupModule {}
