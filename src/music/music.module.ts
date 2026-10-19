import { Global, Module } from '@nestjs/common';
import { AirPlayService } from './airplay.service';
import { MusicService } from './music.service';
import { RadioService } from './radio.service';

/** Global so the action router, conversation (ducking) and control panel share one player. */
@Global()
@Module({ providers: [MusicService, RadioService, AirPlayService], exports: [MusicService, RadioService, AirPlayService] })
export class MusicModule {}
