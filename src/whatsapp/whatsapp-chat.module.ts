import { Module } from '@nestjs/common';
import { ActionsModule } from '../actions/actions.module';
import { LlmModule } from '../llm/llm.module';
import { MemoryModule } from '../memory/memory.module';
import { WhatsAppChatService } from './whatsapp-chat.service';

/** Chatting with Max in your own WhatsApp chat (same AI and actions as the voice). */
@Module({ imports: [LlmModule, ActionsModule, MemoryModule], providers: [WhatsAppChatService] })
export class WhatsAppChatModule {}
