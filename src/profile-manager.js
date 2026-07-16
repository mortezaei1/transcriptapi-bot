import fs from 'fs';
import path from 'path';
import logger from './logger.js';

/**
 * Manages a pool of fresh Chrome profiles for the signup browser.
 * Each profile can do ~20 signups before TranscriptAPI rate-limits it.
 * When the limit is hit, call switchToNextProfile() to rotate.
 */
export class ProfileManager {
  /**
   * @param {Object} config Application config
   */
  constructor(config) {
    this.profilesDir = path.resolve(config.profilesDir || './profiles');
    this.currentIndex = 0;
    fs.mkdirSync(this.profilesDir, { recursive: true });
    this._ensureCurrentProfileExists();
    logger.info(`ProfileManager ready — profiles dir: ${this.profilesDir}`);
    logger.info(`Active signup profile: #${this.currentIndex} (${this.getCurrentProfilePath()})`);
  }

  /**
   * Return the path to the currently active profile directory.
   */
  getCurrentProfilePath() {
    return path.join(this.profilesDir, `profile-${this.currentIndex}`);
  }

  /**
   * Switch to the next (fresh) profile.
   * Call this when "Too many signup attempts" is detected.
   * @returns {string} Path to the new profile directory
   */
  switchToNextProfile() {
    this.currentIndex++;
    this._ensureCurrentProfileExists();
    const newPath = this.getCurrentProfilePath();
    logger.warn(`🔄 Profile rotated → #${this.currentIndex}: ${newPath}`);
    return newPath;
  }

  /** @private */
  _ensureCurrentProfileExists() {
    fs.mkdirSync(this.getCurrentProfilePath(), { recursive: true });
  }
}

export default ProfileManager;
