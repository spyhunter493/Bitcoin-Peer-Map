export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = typeof LOG_LEVELS[number];
export type Logger = Record<LogLevel, (message: string) => void>;

let minimumLevel: LogLevel = 'info';
let secretPattern: RegExp | null = null;

export function configureLogging(options: { level: LogLevel; secrets?: readonly (string | null | undefined)[] }) {
    minimumLevel = options.level;
    const secrets = [...new Set(options.secrets?.filter((value): value is string => Boolean(value)) ?? [])].sort((a, b) => b.length - a.length);
    const patterns = secrets.map(secret => {
        const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Short, user-chosen credentials must not obscure unrelated words in messages.
        return secret.length < 8 ? `(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])` : escaped;
    });
    secretPattern = patterns.length ? new RegExp(patterns.join('|'), 'g') : null;
}

function safeMessage(message: string) {
    const value = secretPattern ? message.replace(secretPattern, '[redacted]') : message;
    return value.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+={0,2}/gi, '$1 [redacted]')
        .replace(/(https?:\/\/)[^\s/]+@/gi, '$1[redacted]@')
        .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ');
}

export function createLogger(component: string): Logger {
    const write = (level: LogLevel, message: string) => {
        if (LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(minimumLevel)) return;
        console[level](`${new Date().toISOString()} ${level.toUpperCase()} [${component}] ${safeMessage(message)}`);
    };
    return {
        debug: message => write('debug', message), info: message => write('info', message),
        warn: message => write('warn', message), error: message => write('error', message),
    };
}

// Each operation owns a reporter: first failure, minute reminders, then one recovery.
export function createFailureReporter(logger: Logger) {
    let failures = 0, lastReportedAt = -Infinity;
    return {
        failure(message: string, level: 'warn' | 'error' = 'warn') {
            failures++;
            const now = performance.now();
            if (failures === 1 || now - lastReportedAt >= 60_000) {
                logger[level](message + (failures > 1 ? ` (${failures} consecutive failures)` : ''));
                lastReportedAt = now;
            } else logger.debug(message);
        },
        recovered(message: string) {
            if (failures) logger.info(`${message} (after ${failures} failed attempts)`);
            failures = 0; lastReportedAt = -Infinity;
        },
    };
}
