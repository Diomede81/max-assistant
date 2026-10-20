import { Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module';
import { AutomationsService } from './automations.service';
import { CamerasService } from './cameras.service';
import { DeviceNamesService } from './device-names.service';
import { HomeService } from './home.service';

@Module({ imports: [MemoryModule], providers: [HomeService, AutomationsService, CamerasService, DeviceNamesService], exports: [HomeService, AutomationsService, CamerasService, DeviceNamesService] })
export class HomeModule {}
