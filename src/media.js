// Media Manager for handling sound files
const fs = require('fs').promises;
const path = require('path');

class MediaManager {
  constructor(config, logger) {
    this.soundsDir = config.soundsDirectory;
    this.cacheDir = config.cacheDirectory;
    this.logger = logger;
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
      const files = await fs.readdir(this.soundsDir);
      
      const sounds = [];
      for (const file of files) {
        if (file.endsWith('.mp3') || file.endsWith('.wav')) {
          sounds.push({
            name: path.basename(file, path.extname(file)),
            filename: file,
            path: path.join(this.soundsDir, file)
          });
        }
      }
      
      return sounds;
    } catch (error) {
      this.logger.error(`Error listing sounds: ${error.message}`);
      return [];
    }
  }
  
  async getSound(name) {
    try {
      const sounds = await this.listSounds();
      return sounds.find(s => s.name.toLowerCase() === name.toLowerCase());
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
}

module.exports = { MediaManager };