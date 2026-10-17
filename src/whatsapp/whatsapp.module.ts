import { Global, Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';

/** Global so the action router and the control panel share one WhatsApp connection. */
@Global()
@Module({ providers: [WhatsAppService], exports: [WhatsAppService] })
export class WhatsAppModule {}
