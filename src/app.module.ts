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
import { JobsModule } from './jobs/jobs.module';
import { SocialModule } from './social/social.module';
import { JournalModule } from './journal/journal.module';
import { ModelsModule } from './models/models.module';
import { DeviceModule } from './device/device.module';
import { UpdatesModule } from './updates/updates.module';
import { BackupModule } from './backup/backup.module';
import { LockModule } from './lock/lock.module';
import { LiveVoiceModule } from './realtime/live-voice.module';
import { TrainsModule } from './trains/trains.module';
import { MeetingsModule } from './meetings/meetings.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { HealthModule } from './health/health.module';
import { WhatsAppChatModule } from './whatsapp/whatsapp-chat.module';

@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), LockModule, LiveVoiceModule, ModelsModule, DeviceModule, UpdatesModule, BackupModule, SoulModule, LocationModule, AboutModule, WebModule, TrainsModule, MeetingsModule, WhatsAppModule, HealthModule, RoutinesModule, JobsModule, SocialModule, JournalModule, MusicModule, FaceModule, ConversationModule, WhatsAppChatModule, ControlPanelModule],
  providers: [{ provide: APP_CONFIG, useFactory: loadConfig }],
  exports: [APP_CONFIG],
})
export class AppModule {}
