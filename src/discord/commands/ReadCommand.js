import { SlashCommandBuilder, InteractionContextType, MessageFlags } from 'discord.js';
import { config } from '../../config/config.js';
import { Logger } from '../../utils/logger.js';
import { truncate } from '../builders/SoundboardView.js';
import { resolveVoice, voiceChoices } from '../../tts/voices.js';

const LOG_TEXT_MAX = 60;

/**
 * /read <text> [voice] - read text aloud in the member's voice channel
 */
export class ReadCommand {
  constructor(ttsService, voiceRepository, audioService, voiceService) {
    this.ttsService = ttsService;
    this.voiceRepository = voiceRepository;
    this.audioService = audioService;
    this.voiceService = voiceService;
  }

  static get definition() {
    return new SlashCommandBuilder()
      .setName('read')
      .setDescription('Read a text aloud in your voice channel')
      .setContexts(InteractionContextType.Guild)
      .addStringOption((option) =>
        option
          .setName('text')
          .setDescription('Text to read')
          .setRequired(true)
          .setMaxLength(config.tts.maxLength)
      )
      .addStringOption((option) =>
        option
          .setName('voice')
          .setDescription('Voice for this read (default: yours, set with /voice)')
          .setAutocomplete(true)
      );
  }

  /**
   * Suggest voices, local search only
   */
  async autocomplete(interaction) {
    const current = this.ttsService.voiceOrDefault(this.voiceRepository.get(interaction.user.id));
    await interaction.respond(voiceChoices(interaction.options.getFocused(), current));
  }

  async execute(interaction) {
    const text = this.ttsService.clean(interaction.options.getString('text', true));
    const voiceInput = interaction.options.getString('voice');
    const context = {
      sound: truncate(text, LOG_TEXT_MAX),
      channel: interaction.member?.voice?.channel?.name,
      via: voiceInput ?? undefined,
    };

    const fail = (reason) => {
      Logger.activity('READ', 'ERROR', interaction, { ...context, reason });
      return interaction.reply({ content: `❌ ${reason}`, flags: MessageFlags.Ephemeral });
    };

    const voice = voiceInput
      ? resolveVoice(voiceInput)
      : this.ttsService.voiceOrDefault(this.voiceRepository.get(interaction.user.id));
    if (!voice) return fail(`No voice found for "${voiceInput}".`);
    context.via = voice.id;

    if (!text) return fail('There is nothing to read in that text.');

    const { channel, error } = this.audioService.resolveVoiceChannel(interaction);
    if (error) return fail(error);

    await interaction.deferReply();

    let result;
    try {
      const audio = await this.ttsService.synthesize(text, voice);
      result = await this.voiceService.read(channel, audio);
    } catch (readError) {
      Logger.activity('READ', 'ERROR', interaction, { ...context, reason: readError.message });
      return interaction.editReply(`❌ Failed to read with **${voice.label}**: ${readError.message}`);
    }

    Logger.activity('READ', 'OK', interaction, {
      ...context,
      reason: result.queued ? `queued #${result.position}` : undefined,
    });

    await interaction.editReply(
      result.queued ? `⏳ Queued (#${result.position}) with **${voice.label}**` : `🗣️ Reading with **${voice.label}**`
    );
    setTimeout(() => interaction.deleteReply().catch(() => {}), 2000);
  }
}
