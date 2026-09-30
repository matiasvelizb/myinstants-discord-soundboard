import { SlashCommandBuilder, InteractionContextType, MessageFlags } from 'discord.js';
import { Logger } from '../../utils/logger.js';
import { resolveVoice, voiceChoices } from '../../tts/voices.js';

/**
 * /voice <voice> - choose the voice /read uses for you
 */
export class VoiceCommand {
  constructor(ttsService, voiceRepository) {
    this.ttsService = ttsService;
    this.voiceRepository = voiceRepository;
  }

  static get definition() {
    return new SlashCommandBuilder()
      .setName('voice')
      .setDescription('Choose the voice /read uses for you')
      .setContexts(InteractionContextType.Guild)
      .addStringOption((option) =>
        option
          .setName('voice')
          .setDescription('Voice name, country or language')
          .setRequired(true)
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
    const input = interaction.options.getString('voice', true);
    const voice = resolveVoice(input);

    if (!voice) {
      Logger.activity('VOICE', 'ERROR', interaction, { sound: input, reason: 'Voice not found' });
      return interaction.reply({
        content: `❌ No voice found for "${input}".`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    }

    this.voiceRepository.set(interaction.user.id, voice.id);
    Logger.activity('VOICE', 'OK', interaction, { sound: voice.id });

    await interaction.reply({
      content: `✅ Your voice is now **${voice.label}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
