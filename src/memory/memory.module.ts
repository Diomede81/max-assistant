import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryLearnerService } from './memory-learner.service';

@Module({ providers: [MemoryService, MemoryLearnerService], exports: [MemoryService, MemoryLearnerService] })
export class MemoryModule {}
