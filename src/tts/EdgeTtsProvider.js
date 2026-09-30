import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const TIMEOUT = 30_000; // Long texts take a while to stream back

const XML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

/**
 * Microsoft Edge "Read Aloud" voices (unofficial endpoint, no API key)
 */
export class EdgeTtsProvider {
  /**
   * @param {string} text
   * @param {string} voice - Edge voice short name, e.g. es-CL-CatalinaNeural
   * @returns {Promise<Buffer>} - MP3 audio
   */
  async synthesize(text, voice) {
    // One client per request: the library cannot switch voices on a used instance
    const tts = new MsEdgeTTS();
    let timer;

    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Edge TTS timed out')), TIMEOUT);
      });
      return await Promise.race([this.request(tts, text, voice), timeout]);
    } finally {
      clearTimeout(timer);
      tts.close();
    }
  }

  async request(tts, text, voice) {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    // The text is embedded in SSML, so it must be escaped
    const { audioStream } = tts.toStream(text.replace(/[&<>"']/g, (char) => XML_ENTITIES[char]));

    const chunks = [];
    for await (const chunk of audioStream) {
      chunks.push(chunk);
    }

    const audio = Buffer.concat(chunks);
    if (audio.length === 0) throw new Error('Edge TTS returned no audio');
    return audio;
  }
}
