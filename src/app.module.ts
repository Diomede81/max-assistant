import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_CONFIG, loadConfig } from './config';
import { ConversationModule } from './conversation/conversation.module';
import { ControlPanelModule } from './control-panel/control-panel.module';
import { MusicModule } from './music/music.module';
import { FaceModule } from './face/face.module';
import { SoulModule } from './soul/soul.module';
import { WebModule } from './web/web.module';
import { LocationModule } from './location/location.module';
import { AboutModule } from './about/about.module';
import { RoutinesModule } from './routines/routines.module';
import { ModelsModule } from './models/models.module';
import { DeviceModule } from './device/device.module';
import { UpdatesModule } from './updates/updates.module';
import { LockModule } from './lock/lock.module';
import { LiveVoiceModule } from './realtime/live-voice.module';
import { TrainsModule } from './trains/trains.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), LockModule, LiveVoiceModule, ModelsModule, DeviceModule, UpdatesModule, SoulModule, LocationModule, AboutModule, WebModule, TrainsModule, WhatsAppModule, RoutinesModule, MusicModule, FaceModule, ConversationModule, ControlPanelModule],
  providers: [{ provide: APP_CONFIG, useFactory: loadConfig }],
  exports: [APP_CONFIG],
})
export class AppModule {}
