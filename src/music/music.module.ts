import { Global, Module } from '@nestjs/common';
import { MusicService } from './music.service';

/** Global so the action router, conversation (ducking) and control panel share one player. */
@Global()
@Module({ providers: [MusicService], exports: [MusicService] })
export class MusicModule {}
