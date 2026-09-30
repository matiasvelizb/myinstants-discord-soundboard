import { Readable } from 'stream';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import { config } from '../../config/config.js';
import { Logger } from '../../utils/logger.js';

/**
 * @typedef {Object} Item
 * @property {'sfx'|'read'} kind
 * @property {string|Buffer} source - Local audio file, or audio held in memory
 *
 * @typedef {Object} Session
 * @property {import('@discordjs/voice').VoiceConnection} connection
 * @property {import('@discordjs/voice').AudioPlayer} player
 * @property {NodeJS.Timeout|null} timer
 * @property {'sfx'|'read'|null} current - What is playing
 * @property {Item[]} sfxQueue - Sounds waiting for a read to finish
 * @property {Item[]} readQueue - Reads waiting for their turn
 */

/**
 * Voice connections and playback, one session (connection + player + queues) per guild.
 *
 * Sounds interrupt each other, but a read is never cut: sounds that arrive during a read
 * wait for it and then play in order, ahead of any waiting read.
 */
export class VoiceService {
  constructor() {
    /** @type {Map<string, Session>} */
    this.sessions = new Map();
  }

  /**
   * Play a sound in a voice channel, interrupting another sound but waiting for a read.
   * Moves the bot if it is connected to another channel of the same guild.
   * @param {Object} voiceChannel - Discord voice channel
   * @param {string} audioPath - Local audio file
   * @returns {Promise<{queued: boolean, position: number}>}
   */
  async play(voiceChannel, audioPath) {
    return this.submit(voiceChannel, { kind: 'sfx', source: audioPath });
  }

  /**
   * Read synthesized speech in a voice channel, after whatever is playing or waiting
   * @param {Object} voiceChannel - Discord voice channel
   * @param {Buffer} audio - Speech audio
   * @returns {Promise<{queued: boolean, position: number}>}
   */
  async read(voiceChannel, audio) {
    return this.submit(voiceChannel, { kind: 'read', source: audio });
  }

  /**
   * Start an item now or queue it, depending on what is playing
   * @param {Object} voiceChannel
   * @param {Item} item
   * @returns {Promise<{queued: boolean, position: number}>} - position counts the items ahead, this one included
   */
  async submit(voiceChannel, item) {
    const session = await this.connect(voiceChannel);
    const guildId = voiceChannel.guild.id;

    const startsNow = item.kind === 'sfx' ? session.current !== 'read' : session.current === null;
    if (startsNow) {
      this.start(guildId, session, item);
      return { queued: false, position: 0 };
    }

    const queue = item.kind === 'sfx' ? session.sfxQueue : session.readQueue;
    if (queue.length >= config.tts.maxQueue) {
      throw new Error('The queue is full, try again in a moment.');
    }
    queue.push(item);

    const position = item.kind === 'sfx' ? queue.length : session.sfxQueue.length + queue.length;
    Logger.logVoice(`Queued ${item.kind} #${position}`, guildId, { channel: voiceChannel.name });
    return { queued: true, position };
  }

  start(guildId, session, item) {
    clearTimeout(session.timer);
    session.current = item.kind;
    session.player.play(
      createAudioResource(typeof item.source === 'string' ? item.source : Readable.from(item.source))
    );
    Logger.logVoice(`Started playing ${item.kind}`, guildId, {
      waiting: session.sfxQueue.length + session.readQueue.length,
    });
  }

  /**
   * The player went idle: play what is waiting (sounds first), or start the inactivity timer
   */
  advance(guildId, session) {
    const next = session.sfxQueue.shift() ?? session.readQueue.shift();
    if (next) {
      this.start(guildId, session, next);
      return;
    }
    session.current = null;
    this.scheduleDisconnect(guildId, session);
  }

  /**
   * Stop a session's player without letting it move on to what was waiting
   */
  halt(guildId, session) {
    const dropped = session.sfxQueue.length + session.readQueue.length;
    session.sfxQueue.length = 0;
    session.readQueue.length = 0;
    session.player.stop(true); // Emits Idle synchronously, which schedules a timer; clear it right after
    clearTimeout(session.timer);
    if (dropped) Logger.logVoice(`Dropped ${dropped} queued items`, guildId);
  }

  /**
   * Join (or move to) a voice channel and wait until the connection is ready
   */
  async connect(voiceChannel) {
    const guildId = voiceChannel.guild.id;

    // Returns the existing connection when there is one, sending a move if the channel differs
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    let session = this.sessions.get(guildId);
    if (session?.connection !== connection) {
      if (session) this.halt(guildId, session);
      session = this.createSession(guildId, connection);
    }

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch (error) {
      this.disconnect(guildId);
      throw new Error(`Failed to join voice channel: ${error.message}`);
    }

    return session;
  }

  createSession(guildId, connection) {
    const player = createAudioPlayer();
    /** @type {Session} */
    const session = { connection, player, timer: null, current: null, sfxQueue: [], readQueue: [] };

    // An errored item ends in Idle like any other, so the queue keeps moving
    player.on('error', (error) => Logger.error('Audio player error', { guildId }, error));
    player.on(AudioPlayerStatus.Idle, () => this.advance(guildId, session));

    connection.on('error', (error) => Logger.error('Voice connection error', { guildId }, error));
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // Moved or reconnecting: give it a moment to recover
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        Logger.warn('Voice connection lost, cleaning up', { guildId });
        connection.destroy();
      }
    });
    connection.on(VoiceConnectionStatus.Destroyed, () => {
      this.halt(guildId, session);
      if (this.sessions.get(guildId) === session) {
        this.sessions.delete(guildId);
      }
    });

    connection.subscribe(player);
    this.sessions.set(guildId, session);
    Logger.logVoice('Created voice connection', guildId);
    return session;
  }

  /**
   * Stop playing, drop what is waiting and leave the voice channel
   * @returns {boolean} - True if disconnected, false if not connected
   */
  disconnect(guildId) {
    const session = this.sessions.get(guildId);
    if (!session) return false;

    if (session.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      session.connection.destroy(); // Destroyed listener cleans up the session
    }
    this.sessions.delete(guildId);
    Logger.logVoice('Disconnected from voice channel', guildId);
    return true;
  }

  disconnectAll() {
    for (const guildId of [...this.sessions.keys()]) {
      this.disconnect(guildId);
    }
  }

  scheduleDisconnect(guildId, session) {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => {
      // A replaced session must not tear down the one that took its place
      if (this.sessions.get(guildId) !== session) return;
      Logger.logVoice('Auto-disconnecting after inactivity', guildId);
      this.disconnect(guildId);
    }, config.bot.autoDisconnectDelay);
  }
}
