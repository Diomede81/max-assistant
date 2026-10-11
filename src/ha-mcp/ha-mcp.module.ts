import { Module } from '@nestjs/common';
import { HaMcpService } from './ha-mcp.service';

@Module({ providers: [HaMcpService], exports: [HaMcpService] })
export class HaMcpModule {}
