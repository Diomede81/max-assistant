import { Module } from '@nestjs/common';
import { MicrophoneService } from './microphone.service';
import { SpeakerService } from './speaker.service';

@Module({
  providers: [MicrophoneService, SpeakerService],
  exports: [MicrophoneService, SpeakerService],
})
export class AudioModule {}
