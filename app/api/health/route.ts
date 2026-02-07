/**
 * Health Check Endpoint
 * Used by Vercel and monitoring systems
 */

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    service: 'audico-whatsapp-agent',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
}
