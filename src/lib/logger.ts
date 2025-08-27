// src/lib/logger.ts
type Level = 'info' | 'warn' | 'error';

export function log(level: Level, message: string, meta: Record<string, unknown> = {}) {
  const ts = new Date().toISOString();
  const line = { ts, level, message, ...meta };
  // Centralizado para enviar a un sink externo si quieres en el futuro
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : level](JSON.stringify(line));
}
