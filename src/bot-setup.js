import { createClient } from 'matrix-js-sdk';
import { CommandHandler } from './command-handler.js';
import { VoiceManager } from './voice-manager.js';
import { RoomManager } from './room-manager.js';

export class BotSetup {
  constructor(options) {
    this.config = {
      homeserverUrl: options.homeserverUrl,
      accessToken: options.accessToken,
      userId: options.userId,
      voiceRoomId: process.env.MATRIX_VOICE_ROOM_ID,
      mediaConfig: options.mediaManager,
      logger: options.logger
    };
    
    this.client = null;
    this.voiceManager = null;
    this.commandHandler = null;
    this.roomManager = null;
  }
  
  async start() {
    const baseUrl = this.config.homeserverUrl.endsWith('/') 
      ? this.config.homeserverUrl.slice(0, -1) 
      : this.config.homeserverUrl;
    
    this.config.logger.info(`Creating client with homeserver: ${baseUrl}`);
    
    this.client = createClient({
      baseUrl: baseUrl,
      accessToken: this.config.accessToken,
      userId: this.config.userId,
      timelineSupport: true
    });

    // Start client first
    await this.client.startClient({});
    
    // Add error handler for sync failures
    this.client.on('sync.error', error => {
      this.config.logger.error('Sync error:', error);
    });
    
    // Wait for initial sync
    await new Promise(resolve => this.client.once('sync', resolve));

   // Ensure logger exists before creating dependencies
    if (!this.config.logger) {
      this.config.logger = console;
    }

    // Initialize components after sync
    this.voiceManager = new VoiceManager(
      this.client, 
      this.config.logger, 
      this.config.voiceRoomId
    );
    
    this.commandHandler = new CommandHandler({
      client: this.client,
      logger: this.config.logger,
      userId: this.config.userId,
      mediaManager: this.config.mediaConfig,
      voiceManager: this.voiceManager
    });
    this.roomManager = new RoomManager(
      this.client,
      this.config.logger,
      this.voiceManager,
      this.commandHandler,
      this.config.userId
    );
    
    this.setupEventHandlers();
    
    try {
      this.config.logger.info(`Matrix bot connected as ${this.config.userId}`);

      // Disconnect from any active calls on startup
      for (const [roomId, callData] of this.voiceManager.activeCalls) {
        this.config.logger.info(`Disconnecting from active call in room ${roomId} on startup`);
        try {
          if (callData?.connection) {
            await callData.connection.disconnect();
          }
        } catch (e) {
          this.config.logger.warn(`Failed to disconnect from room ${roomId} on startup`, e);
        }
        this.voiceManager.activeCalls.delete(roomId);
      }

      this.roomManager.processExistingRooms();
      return this;
    } catch (error) {
      this.config.logger.error(`Failed to start client: ${error.message}`);
      throw error;
    }

  }

  setupEventHandlers() {
    this.client.on('RoomMember.membership', (event, member) => 
      this.roomManager.handleRoomMembership(event, member));
      
    this.client.on('Room.timeline', (event, room) => 
      this.roomManager.handleRoomTimeline(event, room));

    this.client.on('sync', (state, prevState, data) => 
      this.roomManager.handleSync(state, prevState, data));
  }
}
