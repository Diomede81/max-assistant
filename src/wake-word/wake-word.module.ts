import { Module } from '@nestjs/common';
import { WakeWordService } from './wake-word.service';

@Module({ providers: [WakeWordService], exports: [WakeWordService] })
export class WakeWordModule {}
