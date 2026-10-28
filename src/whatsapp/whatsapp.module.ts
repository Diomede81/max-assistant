import { Global, Module } from '@nestjs/common';
import { SttModule } from '../stt/stt.module';
import { WhatsAppService } from './whatsapp.service';

/** Global so the action router and the control panel share one WhatsApp connection. */
@Global()
@Module({ imports: [SttModule], providers: [WhatsAppService], exports: [WhatsAppService] })
export class WhatsAppModule {}
