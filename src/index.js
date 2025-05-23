// Matrix Soundboard Bot - Main Entry Point
import dotenv from 'dotenv';
dotenv.config();
import winston from 'winston';
import { MatrixBot } from './bot.js';
import { MediaManager } from './media.js';
import path from 'path';
import fs from 'fs';

// Ensure sound directory exists
const soundsDir = process.env.SOUNDS_DIRECTORY || './sounds';
const cacheDir = process.env.CACHE_DIRECTORY || './cache';

if (!fs.existsSync(soundsDir)) {
  fs.mkdirSync(soundsDir, { recursive: true });
}

if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

// Simple logger configuration
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.simple()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ filename: 'bot.log' })
  ]
});

// Config from environment variables
const config = {
  matrix: {
    homeserverUrl: process.env.MATRIX_HOMESERVER_URL,
    accessToken: process.env.MATRIX_ACCESS_TOKEN,
    userId: process.env.MATRIX_BOT_USER_ID,
    voiceRoomId: process.env.MATRIX_VOICE_ROOM_ID,
  },
  media: {
    soundsDirectory: soundsDir,
    cacheDirectory: cacheDir,
  }
};

// Log configuration (without sensitive info)
logger.info(`Homeserver URL: ${config.matrix.homeserverUrl}`);
logger.info(`User ID: ${config.matrix.userId}`);
logger.info(`Access token available: ${config.matrix.accessToken ? 'Yes' : 'No'}`);
logger.info(`Voice room ID: ${config.matrix.voiceRoomId || 'Not configured (will auto-detect)'}`);

async function main() {
  try {
    // Initialize the media manager
    const mediaManager = new MediaManager(config.media, logger);
    await mediaManager.initialize();
    
    // Create and start the bot
    const botConfig = {
      ...config.matrix,
      mediaManager,
      logger
    };
    
    if (!config.matrix.voiceRoomId) {
      delete botConfig.voiceRoomId;
    }

    const bot = new MatrixBot(botConfig);
    
    await bot.start();
    
    // Get version from package.json
    const packageJson = JSON.parse(fs.readFileSync('./package.json'));
    logger.info(`Bot started successfully - Version ${packageJson.version}`, {
      sanitized: true,
      features: ['commands', 'voice', 'media']
    });
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down bot...');
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.info('Shutting down bot...');
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Failed to start bot: ' + error.message);
    process.exit(1);
  }
}

main();
