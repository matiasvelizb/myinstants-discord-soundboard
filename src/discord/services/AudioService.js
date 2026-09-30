import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { Logger } from '../../utils/logger.js';
import { cleanTitle } from '../builders/SoundboardView.js';

/**
 * Plays saved sounds: checks voice access, fetches audio from disk (downloading once), counts plays
 */
export class AudioService {
  constructor(soundRepository, scraperService, voiceService, audioStore) {
    this.soundRepository = soundRepository;
    this.scraperService = scraperService;
    this.voiceService = voiceService;
    this.audioStore = audioStore;
  }

  /**
   * The member's voice channel, if the bot can join and speak there
   * @returns {{channel?: Object, error?: string}}
   */
  resolveVoiceChannel(interaction) {
    const channel = interaction.member?.voice?.channel;
    if (!channel) {
      return { error: 'You need to be in a voice channel first!' };
    }

    const permissions = channel.permissionsFor(interaction.client.user);
    if (!permissions?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
      return { channel, error: 'I need permission to join and speak in your voice channel!' };
    }

    return { channel };
  }

  /**
   * Local path of a sound's audio, downloading it from MyInstants the first time
   * @param {string} soundUrl
   * @returns {Promise<string>}
   */
  async getAudioPath(soundUrl) {
    if (this.audioStore.has(soundUrl)) {
      return this.audioStore.pathFor(soundUrl);
    }
    const buffer = await this.scraperService.downloadSound(soundUrl);
    return this.audioStore.save(soundUrl, buffer);
  }

  /**
   * Delete a sound's audio file once no guild has it saved anymore
   */
  async releaseAudio(soundUrl) {
    if (!this.soundRepository.isAudioUsed(soundUrl)) {
      await this.audioStore.remove(soundUrl);
    }
  }

  /**
   * Play a saved sound and log the result
   * @param {Object} interaction - Discord interaction (for logging)
   * @param {Object} channel - Voice channel
   * @param {Object} sound - Sound row
   * @param {string} via - '/play' or 'button'
   * @returns {Promise<{error?: string, queued?: boolean, position?: number}>} - queued when it waits for a read to finish
   */
  async play(interaction, channel, sound, via) {
    const context = { via, sound: cleanTitle(sound.title), channel: channel.name };

    try {
      const audioPath = await this.getAudioPath(sound.sound_url);
      const { queued, position } = await this.voiceService.play(channel, audioPath);
      this.soundRepository.incrementPlays(sound.id);
      Logger.activity('PLAY', 'OK', interaction, {
        ...context,
        reason: queued ? `queued #${position} behind read` : undefined,
      });
      return { queued, position };
    } catch (error) {
      Logger.activity('PLAY', 'ERROR', interaction, { ...context, reason: error.message });
      return { error: error.message };
    }
  }

  /**
   * Soundboard button: play without posting a message, reply only on errors
   * @param {Object} interaction - Button interaction
   * @param {number} soundId
   */
  async handleButton(interaction, soundId) {
    const sound = this.soundRepository.getById(interaction.guild.id, soundId);
    if (!sound) {
      Logger.activity('PLAY', 'ERROR', interaction, { via: 'button', reason: 'Sound not found' });
      return interaction.reply({
        content: '❌ This sound is no longer available!',
        flags: MessageFlags.Ephemeral,
      });
    }

    const { channel, error } = this.resolveVoiceChannel(interaction);
    if (error) {
      Logger.activity('PLAY', 'ERROR', interaction, {
        via: 'button',
        sound: cleanTitle(sound.title),
        channel: channel?.name,
        reason: error,
      });
      return interaction.reply({ content: `❌ ${error}`, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferUpdate();
    const { error: playError } = await this.play(interaction, channel, sound, 'button');
    if (playError) {
      await interaction.followUp({
        content: `❌ Failed to play **${cleanTitle(sound.title)}**: ${playError}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
