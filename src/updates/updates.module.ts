import { Global, Module } from '@nestjs/common';
import { UpdatesService } from './updates.service';

/** Global: the control panel and the action router use it. */
@Global()
@Module({ providers: [UpdatesService], exports: [UpdatesService] })
export class UpdatesModule {}
