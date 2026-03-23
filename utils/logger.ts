/* eslint-disable no-console */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const CURRENT_LEVEL: LogLevel = 'debug';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[CURRENT_LEVEL];
}

function formatMessage(category: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${category}] ${message}`;
}

export const logger = {
  debug(category: string, message: string, ...args: unknown[]): void {
    if (shouldLog('debug')) {
      console.debug(formatMessage(category, message), ...args);
    }
  },

  info(category: string, message: string, ...args: unknown[]): void {
    if (shouldLog('info')) {
      console.info(formatMessage(category, message), ...args);
    }
  },

  warn(category: string, message: string, ...args: unknown[]): void {
    if (shouldLog('warn')) {
      console.warn(formatMessage(category, message), ...args);
    }
  },

  error(category: string, message: string, ...args: unknown[]): void {
    if (shouldLog('error')) {
      console.error(formatMessage(category, message), ...args);
    }
  },
};
