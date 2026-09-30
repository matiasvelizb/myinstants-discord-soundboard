import { SlashCommandBuilder, InteractionContextType, MessageFlags } from 'discord.js';
import { Logger } from '../../utils/logger.js';
import { cleanTitle, truncate } from '../builders/SoundboardView.js';
import { ScraperService } from '../../myinstants/ScraperService.js';

const AUTOCOMPLETE_LIMIT = 25;
const CHOICE_MAX = 100; // Discord limit for choice name and value
const SEARCH_TIMEOUT = 2000; // Autocomplete must answer within 3 seconds

/**
 * /play <sound> - play a saved sound, a MyInstants link, or search MyInstants by name
 */
export class PlayCommand {
  constructor(scraperService, soundRepository, audioService, dashboardService) {
    this.scraperService = scraperService;
    this.soundRepository = soundRepository;
    this.audioService = audioService;
    this.dashboardService = dashboardService;
  }

  static get definition() {
    return new SlashCommandBuilder()
      .setName('play')
      .setDescription('Play a sound from myinstants.com')
      .setContexts(InteractionContextType.Guild)
      .addStringOption((option) =>
        option
          .setName('sound')
          .setDescription('Sound name or myinstants.com link')
          .setRequired(true)
          .setAutocomplete(true)
      );
  }

  /**
   * Suggest saved sounds first, then live MyInstants search results
   */
  async autocomplete(interaction) {
    const query = interaction.options.getFocused().trim();
    const choices = [];

    if (/^https?:\/\//i.test(query)) {
      if (ScraperService.toMyInstantsUrl(query) && query.length <= CHOICE_MAX) {
        choices.push({ name: '🔗 Play this link', value: query });
      }
      return interaction.respond(choices);
    }

    for (const sound of this.soundRepository.search(interaction.guild.id, query, AUTOCOMPLETE_LIMIT)) {
      choices.push({
        name: truncate(`💾 ${cleanTitle(sound.title)} · ${sound.play_count} plays`, CHOICE_MAX),
        value: `saved:${sound.id}`,
      });
    }

    if (query && choices.length < AUTOCOMPLETE_LIMIT) {
      const results = await Promise.race([
        this.scraperService.search(query),
        new Promise((resolve) => setTimeout(resolve, SEARCH_TIMEOUT, [])),
      ]).catch((error) => {
        Logger.debug('MyInstants search failed', { query, error: error.message });
        return [];
      });

      for (const result of results) {
        if (choices.length >= AUTOCOMPLETE_LIMIT) break;
        const value = new URL(result.pageUrl).pathname;
        if (value.length > CHOICE_MAX) continue;
        choices.push({ name: truncate(`🌐 ${result.title}`, CHOICE_MAX), value });
      }
    }

    await interaction.respond(choices);
  }

  async execute(interaction) {
    const input = interaction.options.getString('sound', true).trim();
    const context = { via: '/play', channel: interaction.member?.voice?.channel?.name };

    const { channel, error } = this.audioService.resolveVoiceChannel(interaction);
    if (error) {
      Logger.activity('PLAY', 'ERROR', interaction, { ...context, sound: input, reason: error });
      return interaction.reply({ content: `❌ ${error}`, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    let sound;
    try {
      sound = await this.resolveSound(interaction, input);
    } catch (resolveError) {
      Logger.activity('PLAY', 'ERROR', interaction, { ...context, sound: input, reason: resolveError.message });
      return interaction.editReply(`❌ ${resolveError.message}`);
    }

    const title = cleanTitle(sound.title);
    const played = await this.audioService.play(interaction, channel, sound, '/play');
    if (played.error) {
      return interaction.editReply(`❌ Failed to play **${title}**: ${played.error}`);
    }

    await interaction.editReply(
      played.queued ? `⏳ Queued (#${played.position}): **${title}**` : `🔊 Playing: **${title}**`
    );
    setTimeout(() => interaction.deleteReply().catch(() => {}), 2000);
  }

  /**
   * Turn the command input into a saved sound row, adding it from MyInstants if needed.
   * Accepts `saved:<id>` (autocomplete), a MyInstants link or path, or free text.
   */
  async resolveSound(interaction, input) {
    const guildId = interaction.guild.id;

    if (input.startsWith('saved:')) {
      const sound = this.soundRepository.getById(guildId, Number(input.slice('saved:'.length)));
      if (!sound) throw new Error('That sound is no longer saved in this server.');
      return sound;
    }

    const isLink = /^https?:\/\//i.test(input) || input.startsWith('/');
    let pageUrl = isLink ? ScraperService.toMyInstantsUrl(input) : null;
    if (isLink && !pageUrl) {
      throw new Error('Only myinstants.com links are supported.');
    }

    if (!pageUrl) {
      const [saved] = this.soundRepository.search(guildId, input, 1);
      if (saved) return saved;

      const [result] = await this.scraperService.search(input);
      if (!result) throw new Error(`No MyInstants sound found for "${input}".`);
      pageUrl = result.pageUrl;
    }

    return this.addFromMyInstants(interaction, pageUrl);
  }

  /**
   * Scrape a MyInstants page, download its audio and save it to the guild
   */
  async addFromMyInstants(interaction, pageUrl) {
    const { soundUrl, title } = await this.scraperService.scrapeMyInstantsSound(pageUrl);
    const clean = cleanTitle(title);

    try {
      // Download before saving so sounds that can't be fetched never reach the soundboard
      await this.audioService.getAudioPath(soundUrl);
    } catch (error) {
      Logger.activity('ADD', 'ERROR', interaction, { sound: clean, reason: error.message });
      throw error;
    }

    const { sound, created, removed } = this.soundRepository.add(interaction.guild.id, {
      soundUrl,
      title,
      originalUrl: pageUrl,
    });

    if (!created) {
      Logger.activity('ADD', 'SKIP', interaction, { sound: clean, reason: 'Already exists' });
      return sound;
    }

    Logger.activity('ADD', 'OK', interaction, { sound: clean });
    for (const old of removed) {
      Logger.activity('DELETE', 'OK', interaction, { sound: cleanTitle(old.title), via: 'auto (limit)' });
      await this.audioService.releaseAudio(old.sound_url);
    }

    await this.dashboardService.refresh(interaction.guild.id);
    return sound;
  }
}
