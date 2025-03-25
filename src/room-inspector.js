import { createClient, MatrixClient } from 'matrix-js-sdk';
import dotenv from 'dotenv';
import winston from 'winston';

dotenv.config();

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
    new winston.transports.File({ filename: 'room-inspector.log' })
  ]
});

async function main() {
  const client = createClient({
    baseUrl: process.env.MATRIX_HOMESERVER_URL,
    accessToken: process.env.MATRIX_ACCESS_TOKEN,
    userId: process.env.MATRIX_BOT_USER_ID
  });

  client.on("Room", function(room) {
    logger.info(`Room ID: ${room.roomId}, Name: ${room.name}`);
    const stateEvents = room.currentState.getStateEvents();
    logger.info(`Room state events for ${room.roomId}: ${JSON.stringify(stateEvents, null, 2)}`);
  });

  client.startClient({initialSyncLimit: 0});
}

main().catch(err => {
  logger.error('Error:', err);
  process.exit(1);
});
