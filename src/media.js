// Media Manager for handling sound files
const fs = require('fs').promises;
const path = require('path');

class MediaManager {
  constructor(config, logger) {
    this.soundsDir = config.soundsDirectory;
    this.cacheDir = config.cacheDirectory;
    this.logger = logger;
    this.soundCache = null;
  }
  
  async initialize() {
    // Ensure directories exist
    try {
      await fs.mkdir(this.soundsDir, { recursive: true });
      await fs.mkdir(this.cacheDir, { recursive: true });
      this.logger.info(`Initialized media directories: ${this.soundsDir}, ${this.cacheDir}`);
      
      // Check for sound files
      const sounds = await this.listSounds();
      this.logger.info(`Found ${sounds.length} sound files`);
    } catch (error) {
      this.logger.error(`Error creating directories: ${error.message}`);
      throw error;
    }
  }
  
  async listSounds() {
    try {
      // If we have cached the sound list, return it
      if (this.soundCache) {
        return this.soundCache;
      }
      
      const files = await fs.readdir(this.soundsDir);
      
      const sounds = [];
      for (const file of files) {
        if (file.endsWith('.mp3') || file.endsWith('.wav')) {
          sounds.push({
            name: path.basename(file, path.extname(file)).toLowerCase(),
            filename: file,
            path: path.join(this.soundsDir, file),
            type: path.extname(file).substring(1) // Remove the dot
          });
        }
      }
      
      // Cache the sounds
      this.soundCache = sounds;
      return sounds;
    } catch (error) {
      this.logger.error(`Error listing sounds: ${error.message}`);
      return [];
    }
  }
  
  async getSound(name) {
    try {
      const sounds = await this.listSounds();
      // Case-insensitive match
      const normalizedName = name.toLowerCase();
      return sounds.find(s => s.name === normalizedName);
    } catch (error) {
      this.logger.error(`Error getting sound: ${error.message}`);
      return null;
    }
  }
  
  async getSoundByFullName(filename) {
    try {
      const sounds = await this.listSounds();
      return sounds.find(s => s.filename.toLowerCase() === filename.toLowerCase());
    } catch (error) {
      this.logger.error(`Error getting sound by filename: ${error.message}`);
      return null;
    }
  }
  
  async readSoundFile(soundPath) {
    try {
      return await fs.readFile(soundPath);
    } catch (error) {
      this.logger.error(`Error reading sound file: ${error.message}`);
      throw error;
    }
  }
  
  // Force refresh of the sound cache
  async refreshSounds() {
    this.soundCache = null;
    return await this.listSounds();
  }
}

module.exports = { MediaManager };