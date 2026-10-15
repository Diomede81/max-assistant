import { Global, Module } from '@nestjs/common';
import { LockService } from './lock.service';

/** Global: the conversation, the action router, the screen and the control panel all check it. */
@Global()
@Module({ providers: [LockService], exports: [LockService] })
export class LockModule {}
