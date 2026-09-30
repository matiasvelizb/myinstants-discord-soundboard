import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { config } from './config/config.js';
import { openDatabase } from './database/db.js';
import { SoundRepository } from './database/SoundRepository.js';
import { VoiceRepository } from './database/VoiceRepository.js';
import { AudioStore } from './database/AudioStore.js';
import { ScraperService } from './myinstants/ScraperService.js';
import { TtsService } from './tts/TtsService.js';
import { VoiceService } from './discord/services/VoiceService.js';
import { DashboardService } from './discord/services/DashboardService.js';
import { AudioService } from './discord/services/AudioService.js';
import { PlayCommand } from './discord/commands/PlayCommand.js';
import { StopCommand } from './discord/commands/StopCommand.js';
import { SoundsCommand } from './discord/commands/SoundsCommand.js';
import { DeleteCommand } from './discord/commands/DeleteCommand.js';
import { ReadCommand } from './discord/commands/ReadCommand.js';
import { VoiceCommand } from './discord/commands/VoiceCommand.js';
import { registerCommands } from './discord/utils/register-commands.js';
import { Logger } from './utils/logger.js';

class Bot {
  constructor() {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    });

    this.db = openDatabase();
    this.soundRepository = new SoundRepository(this.db);
    this.voiceRepository = new VoiceRepository(this.db);
    this.scraperService = new ScraperService();
    this.voiceService = new VoiceService();
    this.ttsService = new TtsService();
    this.audioService = new AudioService(this.soundRepository, this.scraperService, this.voiceService, new AudioStore());
    this.dashboardService = new DashboardService(this.soundRepository, this.client);

    this.commands = {
      play: new PlayCommand(this.scraperService, this.soundRepository, this.audioService, this.dashboardService),
      stop: new StopCommand(this.voiceService),
      sounds: new SoundsCommand(this.dashboardService),
      delete: new DeleteCommand(this.soundRepository, this.audioService, this.dashboardService),
      read: new ReadCommand(this.ttsService, this.voiceRepository, this.audioService, this.voiceService),
      voice: new VoiceCommand(this.ttsService, this.voiceRepository),
    };

    this.client.once(Events.ClientReady, async () => {
      Logger.info('Bot is ready', {
        username: this.client.user.tag,
        userId: this.client.user.id,
        guildCount: this.client.guilds.cache.size,
      });
      await registerCommands([PlayCommand, StopCommand, SoundsCommand, DeleteCommand, ReadCommand, VoiceCommand])
        .catch((error) => Logger.error('Failed to register slash commands', {}, error));
    });

    this.client.on(Events.InteractionCreate, (interaction) => this.route(interaction));

    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  async route(interaction) {
    try {
      if (interaction.isAutocomplete()) {
        return await this.commands[interaction.commandName]?.autocomplete?.(interaction);
      }
      if (interaction.isChatInputCommand()) {
        return await this.commands[interaction.commandName]?.execute(interaction);
      }
      if (interaction.isButton()) {
        return await this.handleButton(interaction);
      }
    } catch (error) {
      Logger.error('Error handling interaction', Logger.getUserContext(interaction), error);
      if (interaction.isRepliable()) {
        const reply = { content: `❌ Something went wrong: ${error.message}`, flags: MessageFlags.Ephemeral };
        await (interaction.deferred || interaction.replied ? interaction.followUp(reply) : interaction.reply(reply))
          .catch(() => {});
      }
    }
  }

  /**
   * Soundboard buttons: sb:<action>:<args...> (see SoundboardView)
   */
  async handleButton(interaction) {
    const [namespace, action, ...args] = interaction.customId.split(':');
    if (namespace !== 'sb') return;

    if (action === 'nav') {
      const [mode, sort, page] = args;
      return this.dashboardService.navigate(interaction, { mode, sort, page: Number(page) });
    }

    const [id, sort, page] = [Number(args[0]), args[1], Number(args[2])];
    switch (action) {
      case 'play': return this.audioService.handleButton(interaction, id);
      case 'del': return this.commands.delete.select(interaction, id, sort, page);
      case 'delc': return this.commands.delete.confirm(interaction, id, sort, page);
      case 'delx': return this.commands.delete.cancel(interaction, sort, page);
    }
  }

  async start() {
    try {
      Logger.info('Logging in to Discord...');
      await this.client.login(config.discord.token);
    } catch (error) {
      Logger.error('Failed to start bot', {}, error);
      await this.shutdown(1);
    }
  }

  async shutdown(code = 0) {
    Logger.info('Shutting down bot...');
    try {
      this.voiceService.disconnectAll();
      await this.scraperService.flareSolverr.destroySession();
      await this.client.destroy();
      this.db.close();
    } catch (error) {
      Logger.error('Error during shutdown', {}, error);
      code = 1;
    }
    process.exit(code);
  }
}

new Bot().start();
