// src/app/api/health/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const requestId = (req.headers as any).get?.('x-request-id') ?? 'no-request-id';
  return NextResponse.json({
    ok: true,
    env: process.env.APP_ENV ?? 'unknown',
    version: process.env.APP_VERSION ?? '0.0.0',
    requestId,
    now: new Date().toISOString(),
  });
}
