const intFromEnv = (name, fallback) => {
  const value = parseInt(process.env[name], 10);
  return Number.isNaN(value) ? fallback : value;
};

export const config = {
  // Discord Configuration
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,
  },

  // Storage: SQLite database and downloaded audio files live here
  dataDir: process.env.DATA_DIR || 'data',

  // FlareSolverr Configuration (Cloudflare challenge solver)
  flaresolverr: {
    url: process.env.FLARESOLVERR_URL || '',
    enabled: process.env.FLARESOLVERR_ENABLED !== 'false',
    maxTimeout: intFromEnv('FLARESOLVERR_MAX_TIMEOUT', 60000),
    sessionName: process.env.FLARESOLVERR_SESSION || 'myinstants-soundboard',
  },

  // Text to speech (/read)
  tts: {
    defaultVoice: process.env.TTS_DEFAULT_VOICE || 'catalina', // Voice id, see src/tts/voices.js
    maxLength: intFromEnv('TTS_MAX_LENGTH', 1000), // Characters per /read (Discord allows up to 6000)
    maxQueue: 10, // Waiting reads, and waiting sounds, per guild
  },

  // Logging Configuration
  log: {
    dir: process.env.LOG_DIR || 'logs',
    retentionDays: 7, // Daily files kept, older ones are deleted
    timezone: process.env.TZ || 'America/Santiago',
    level: (process.env.LOG_LEVEL || 'info').toLowerCase(), // 'info' or 'debug'
  },

  // Bot Configuration
  bot: {
    maxSoundsPerGuild: intFromEnv('MAX_SOUNDS_PER_GUILD', 1000), // 0 = unlimited
    autoDisconnectDelay: 15 * 60 * 1000, // 15 minutes
  },
};
