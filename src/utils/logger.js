import fs from 'fs';
import path from 'path';
import { config } from '../config/config.js';

const LOG_PREFIX = 'soundboard-';
const LOG_SUFFIX = '.log';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Daily log file writer with retention
 * One file per local day: logs/soundboard-YYYY-MM-DD.log
 * Files older than config.log.retentionDays are deleted when a new day starts
 */
class LogFile {
  constructor() {
    this.currentDate = null;
    this.filePath = null;
    this.disabled = false;
  }

  write(date, line) {
    if (this.disabled) return;

    try {
      if (date !== this.currentDate) {
        this.open(date);
      }
      // Sync append: low volume, and nothing is lost on process.exit()
      fs.appendFileSync(this.filePath, line + '\n');
    } catch (error) {
      this.disable(error);
    }
  }

  open(date) {
    fs.mkdirSync(config.log.dir, { recursive: true });
    this.filePath = path.join(config.log.dir, `${LOG_PREFIX}${date}${LOG_SUFFIX}`);
    this.currentDate = date;
    this.cleanup(date);
  }

  /**
   * Delete log files older than the retention window
   * @param {string} today - Current local date (YYYY-MM-DD)
   */
  cleanup(today) {
    const cutoff = Date.parse(today) - (config.log.retentionDays - 1) * DAY_MS;

    for (const file of fs.readdirSync(config.log.dir)) {
      if (!file.startsWith(LOG_PREFIX) || !file.endsWith(LOG_SUFFIX)) continue;

      const fileDate = Date.parse(file.slice(LOG_PREFIX.length, -LOG_SUFFIX.length));
      if (!Number.isNaN(fileDate) && fileDate < cutoff) {
        fs.rmSync(path.join(config.log.dir, file), { force: true });
      }
    }
  }

  disable(error) {
    if (this.disabled) return;
    this.disabled = true;
    console.error(`[logger] Cannot write log files in "${config.log.dir}", logging to console only: ${error.message}`);
  }
}

// 'sv-SE' formats as "YYYY-MM-DD HH:mm:ss"
const timestampFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: config.log.timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const logFile = new LogFile();

/**
 * Logging utility with readable local timestamps and daily rotating files
 * Provides consistent logging format across the application
 */
export class Logger {
  /**
   * Current local timestamp
   * @returns {string} - "YYYY-MM-DD HH:mm:ss" in config.log.timezone
   */
  static timestamp() {
    return timestampFormatter.format(new Date());
  }

  /**
   * Write a line to console and to today's log file
   * @param {string} line - Line without timestamp
   * @param {boolean} isError - Write to stderr
   */
  static write(line, isError = false) {
    const timestamp = this.timestamp();
    const output = `${timestamp} | ${line}`;

    if (isError) {
      console.error(output);
    } else {
      console.log(output);
    }

    logFile.write(timestamp.slice(0, 10), output);
  }

  /**
   * Format a log message with context
   * @param {string} level - Log level (INFO, ERROR, WARN, DEBUG)
   * @param {string} message - Log message
   * @param {Object} context - Additional context (guildId, guildName, username, etc.)
   * @returns {string} - Formatted log message
   */
  static format(level, message, context = {}) {
    const parts = [level.padEnd(5)];

    if (context.guildName || context.guildId) {
      parts.push(this.named(context.guildName, context.guildId));
    }

    if (context.username || context.userId) {
      parts.push(this.named(context.username, context.userId));
    }

    if (context.action) {
      parts.push(context.action);
    }

    parts.push(message);

    return parts.join(' | ');
  }

  /**
   * Format a name with its Discord ID: "Name (123)"
   * @param {string} name - Display name
   * @param {string} id - Discord ID
   * @returns {string}
   */
  static named(name, id) {
    if (!name && !id) return '-';
    if (!name || !id) return name || id;
    return `${name} (${id})`;
  }

  /**
   * Log a user activity: who did what with which sound, and whether it worked
   * Output: "2026-09-22 14:30:05 | PLAY   | OK    | Server (id) | user (id) | Sound | voice: General | via: button"
   * @param {string} action - PLAY, ADD, DELETE, STOP, READ, VOICE
   * @param {string} status - OK, ERROR, SKIP
   * @param {Object} interaction - Discord interaction
   * @param {Object} details - Optional { sound, channel, via, reason }; for READ, sound is the text and via the voice
   */
  static activity(action, status, interaction, { sound, channel, via, reason } = {}) {
    const parts = [
      action.padEnd(6),
      status.padEnd(5),
      this.named(interaction.guild?.name, interaction.guild?.id),
      this.named(interaction.user?.username, interaction.user?.id),
      sound || '-',
    ];

    if (channel) parts.push(`voice: ${channel}`);
    if (via) parts.push(`via: ${via}`);
    if (reason) parts.push(`${status === 'ERROR' ? 'error' : 'reason'}: ${reason}`);

    this.write(parts.join(' | '), status === 'ERROR');
  }

  /**
   * Log an info message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  static info(message, context = {}) {
    this.write(this.format('INFO', message, context));
  }

  /**
   * Log an error message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   * @param {Error} error - Error object (optional)
   */
  static error(message, context = {}, error = null) {
    const detail = error ? `: ${error.message}` : '';
    this.write(this.format('ERROR', `${message}${detail}`, context), true);
    if (error?.stack && config.log.level === 'debug') {
      console.error(error.stack);
    }
  }

  /**
   * Log a warning message
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  static warn(message, context = {}) {
    this.write(this.format('WARN', message, context));
  }

  /**
   * Log a debug message (only when LOG_LEVEL=debug, console only)
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  static debug(message, context = {}) {
    if (config.log.level !== 'debug') return;
    console.log(`${this.timestamp()} | ${this.format('DEBUG', message, context)}`);
  }

  /**
   * Extract user context from Discord interaction
   * @param {Object} interaction - Discord interaction
   * @returns {Object} - User context object
   */
  static getUserContext(interaction) {
    return {
      guildId: interaction.guild?.id,
      guildName: interaction.guild?.name,
      userId: interaction.user?.id,
      username: interaction.user?.username,
    };
  }

  /**
   * Log voice service operation (debug)
   * @param {string} operation - Voice operation name
   * @param {string} guildId - Guild ID
   * @param {Object} additionalContext - Additional context
   */
  static logVoice(operation, guildId, additionalContext = {}) {
    this.debug(operation, { guildId, action: 'Voice', ...additionalContext });
  }
}
