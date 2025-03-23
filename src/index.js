// Matrix Soundboard Bot - Main Entry Point
require('dotenv').config();
const winston = require('winston');
const { MatrixBot } = require('./bot');
const { MediaManager } = require('./media');

// Simple logger configuration
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.simple()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'bot.log' })
  ]
});

// Config from environment variables
const config = {
  matrix: {
    homeserverUrl: process.env.MATRIX_HOMESERVER_URL,
    accessToken: process.env.MATRIX_ACCESS_TOKEN,
    userId: process.env.MATRIX_BOT_USER_ID,
  },
  media: {
    soundsDirectory: process.env.SOUNDS_DIRECTORY || './sounds',
    cacheDirectory: process.env.CACHE_DIRECTORY || './cache',
  }
};

// Log configuration (without sensitive info)
logger.info(`Homeserver URL: ${config.matrix.homeserverUrl}`);
logger.info(`User ID: ${config.matrix.userId}`);
logger.info(`Access token available: ${config.matrix.accessToken ? 'Yes' : 'No'}`);

async function main() {
  try {
    // Initialize the media manager
    const mediaManager = new MediaManager(config.media, logger);
    await mediaManager.initialize();
    
    // Create and start the bot
    const bot = new MatrixBot({
      homeserverUrl: config.matrix.homeserverUrl,
      accessToken: config.matrix.accessToken,
      userId: config.matrix.userId,
      mediaManager: mediaManager,
      logger
    });
    
    await bot.start();
    
    logger.info('Matrix Soundboard Bot started successfully');
    
    // Handle shutdown gracefully
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down...');
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down...');
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Failed to start bot: ' + error.message);
    process.exit(1);
  }
}

main();