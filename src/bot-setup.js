import { createClient } from 'matrix-js-sdk';
import { CommandHandler } from './command-handler.js';
import { VoiceManager } from './voice-manager.js';
import { RoomManager } from './room-manager.js';

export class BotSetup {
  constructor(options) {
    this.homeserverUrl = options.homeserverUrl;
    this.accessToken = options.accessToken;
    this.userId = options.userId;
    this.mediaManager = options.mediaManager;
    this.logger = options.logger;
    
    this.client = null;
    this.voiceManager = null;
    this.commandHandler = null;
    this.roomManager = null;
  }
  
  async start() {
    const baseUrl = this.homeserverUrl.endsWith('/') 
      ? this.homeserverUrl.slice(0, -1) 
      : this.homeserverUrl;
    
    this.logger.info(`Creating client with homeserver: ${baseUrl}`);
    
    this.client = createClient({
      baseUrl: baseUrl,
      accessToken: this.accessToken,
      userId: this.userId,
      timelineSupport: true
    });

    // Start client first
    await this.client.startClient({ initialSyncLimit: 10 });
    
    // Wait for initial sync
    await new Promise(resolve => this.client.once('sync', resolve));

    // Initialize components after sync
    this.voiceManager = new VoiceManager(this.client, this.logger);
    this.commandHandler = new CommandHandler(this);
    this.roomManager = new RoomManager(
      this.client,
      this.logger,
      this.voiceManager,
      this.commandHandler,
      this.userId
    );
    
    this.setupEventHandlers();
    
    try {
      this.logger.info(`Matrix bot connected as ${this.userId}`);
      this.roomManager.processExistingRooms();
      return this;
    } catch (error) {
      this.logger.error(`Failed to start client: ${error.message}`);
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
