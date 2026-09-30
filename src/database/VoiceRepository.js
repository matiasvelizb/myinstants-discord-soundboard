/**
 * Each user's default text-to-speech voice, stored in SQLite
 */
export class VoiceRepository {
  /**
   * @param {import('node:sqlite').DatabaseSync} db
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * @returns {string|null} - Voice id, or null if the user never chose one
   */
  get(userId) {
    return this.db.prepare('SELECT voice FROM user_voices WHERE user_id = ?').get(userId)?.voice ?? null;
  }

  set(userId, voiceId) {
    this.db.prepare(
      `INSERT INTO user_voices (user_id, voice) VALUES (?, ?)
       ON CONFLICT (user_id) DO UPDATE SET voice = excluded.voice`
    ).run(userId, voiceId);
  }
}
