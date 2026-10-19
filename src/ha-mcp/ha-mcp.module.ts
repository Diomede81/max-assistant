import { Module } from '@nestjs/common';
import { HomeModule } from '../home/home.module';
import { HaMcpService } from './ha-mcp.service';

@Module({ imports: [HomeModule], providers: [HaMcpService], exports: [HaMcpService] })
export class HaMcpModule {}
