import { Module } from '@nestjs/common';
import { AutomationsService } from './automations.service';
import { HomeService } from './home.service';

@Module({ providers: [HomeService, AutomationsService], exports: [HomeService, AutomationsService] })
export class HomeModule {}
