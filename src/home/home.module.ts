import { Module } from '@nestjs/common';
import { AutomationsService } from './automations.service';
import { CamerasService } from './cameras.service';
import { HomeService } from './home.service';

@Module({ providers: [HomeService, AutomationsService, CamerasService], exports: [HomeService, AutomationsService, CamerasService] })
export class HomeModule {}
