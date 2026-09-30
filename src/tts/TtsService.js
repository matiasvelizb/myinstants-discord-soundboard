import { config } from '../config/config.js';
import { EdgeTtsProvider } from './EdgeTtsProvider.js';
import { getVoice } from './voices.js';

/**
 * Text to speech: cleans the text and returns the audio of a voice
 */
export class TtsService {
  constructor(edge = new EdgeTtsProvider()) {
    this.edge = edge;
  }

  /**
   * The voice a user reads with: the given one, else the default
   * @param {string|null} voiceId
   * @returns {Object}
   */
  voiceOrDefault(voiceId) {
    return (voiceId && getVoice(voiceId)) || getVoice(config.tts.defaultVoice) || getVoice('catalina');
  }

  /**
   * Make pasted Discord text readable: no links, mentions or emoji markup
   * @param {string} text
   * @returns {string}
   */
  clean(text) {
    return text
      .replace(/https?:\/\/\S+/gi, ' enlace ')
      .replace(/<a?:(\w+):\d+>/g, ' $1 ')
      .replace(/<[@#][!&]?\d+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * @param {string} text - Already cleaned text
   * @param {Object} voice - Voice from the catalog
   * @returns {Promise<Buffer>} - MP3 audio
   */
  async synthesize(text, voice) {
    return this.edge.synthesize(text, voice.voice);
  }
}
