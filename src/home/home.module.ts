import { Module } from '@nestjs/common';
import { HomeService } from './home.service';

@Module({ providers: [HomeService], exports: [HomeService] })
export class HomeModule {}
