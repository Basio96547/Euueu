import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health') health() { return { data: { status: 'ok' } }; }
  @Get('ready') ready() { return { data: { status: 'ready' } }; }
}
