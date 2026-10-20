import { Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module';
import { AutomationsService } from './automations.service';
import { CamerasService } from './cameras.service';
import { HomeService } from './home.service';

@Module({ imports: [MemoryModule], providers: [HomeService, AutomationsService, CamerasService], exports: [HomeService, AutomationsService, CamerasService] })
export class HomeModule {}
