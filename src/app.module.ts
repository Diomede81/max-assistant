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
import { RoutinesModule } from './routines/routines.module';
import { ModelsModule } from './models/models.module';
import { DeviceModule } from './device/device.module';
import { UpdatesModule } from './updates/updates.module';
import { LockModule } from './lock/lock.module';

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), LockModule, ModelsModule, DeviceModule, UpdatesModule, SoulModule, LocationModule, WebModule, RoutinesModule, MusicModule, FaceModule, ConversationModule, ControlPanelModule],
  providers: [{ provide: APP_CONFIG, useFactory: loadConfig }],
  exports: [APP_CONFIG],
})
export class AppModule {}
