const sdk = require('matrix-js-sdk');
const { CommandHandler } = require('./commands');
const { VoiceManager } = require('./voice-manager');

class MatrixBot {
  constructor(options) {
    this.homeserverUrl = options.homeserverUrl;
    this.accessToken = options.accessToken;
    this.userId = options.userId;
    this.mediaManager = options.mediaManager;
    this.logger = options.logger;
    
    this.client = null;
    this.voiceManager = null;
    this.commandHandler = null;
  }
  
  async start() {
    // Make sure homeserver URL doesn't have a trailing slash
    const baseUrl = this.homeserverUrl.endsWith('/') 
      ? this.homeserverUrl.slice(0, -1) 
      : this.homeserverUrl;
    
    // Initialize Matrix client
    this.logger.info(`Creating client with homeserver: ${baseUrl}`);
    
    this.client = sdk.createClient({
      baseUrl: baseUrl,
      accessToken: this.accessToken,
      userId: this.userId,
      timelineSupport: true
    });
    
    // Initialize managers
    this.voiceManager = new VoiceManager(this.client, this.logger);
    this.commandHandler = new CommandHandler(this);
    
    // Set up event handlers
    this.setupEventHandlers();
    
    // Start the client
    this.logger.info('Starting Matrix client...');
    try {
      await this.client.startClient({ initialSyncLimit: 10 });
      this.logger.info(`Matrix bot connected as ${this.userId}`);
    } catch (error) {
      this.logger.error(`Failed to start client: ${error.message}`);
      throw error;
    }
    
    return this;
  }
  
  // Helper method to check if a room is encrypted
  isRoomEncrypted(room) {
    if (!room) return false;
    
    // Check for encryption in room state
    const encryptionEvent = room.currentState.getStateEvents('m.room.encryption', '');
    return !!encryptionEvent;
  }
  
  setupEventHandlers() {
    // Handle room invites
    this.client.on('RoomMember.membership', async (event, member) => {
      if (member.userId === this.userId && member.membership === 'invite') {
        this.logger.info(`Invited to room ${member.roomId}, auto-joining...`);
        try {
          await this.client.joinRoom(member.roomId);
          // Wait a moment before sending the welcome message to ensure room state is loaded
          setTimeout(async () => {
            try {
              const room = this.client.getRoom(member.roomId);
              if (room && this.isRoomEncrypted(room)) {
                this.logger.info(`Room ${member.roomId} is encrypted, can't send messages`);
                return;
              }
              
              await this.client.sendTextMessage(
                member.roomId, 
                "Hello! I'm a soundboard bot. Type !help for available commands."
              );
              
              // Check if this is a voice room
              this.voiceManager.detectVoiceRoom(room);
            } catch (error) {
              this.logger.error(`Error sending welcome message: ${error.message}`);
            }
          }, 2000);
        } catch (error) {
          this.logger.error(`Error joining room: ${error.message}`);
        }
      }
    });
    
    // Handle messages
    this.client.on('Room.timeline', async (event, room) => {
      try {
        // Only handle text messages that aren't from the bot
        if (event.getType() === 'm.room.message' && 
            event.getSender() !== this.userId &&
            event.getContent().msgtype === 'm.text') {
          
          // Check if room is encrypted
          if (room && this.isRoomEncrypted(room)) {
            this.logger.info(`Ignoring message in encrypted room ${room.roomId}`);
            return;
          }
          
          await this.commandHandler.handleCommand(room.roomId, event);
        }
        
        // Track widget events for call detection
        if (event.getType() === 'm.widget') {
          this.logger.info(`Widget event in room ${room.roomId}`);
          // Check if this is a call widget
          const content = event.getContent();
          if (content && (content.type === 'jitsi' || content.url?.includes('element-call'))) {
            this.logger.info(`Call widget detected in room ${room.roomId}: ${content.url}`);
            // Mark this as a voice room
            this.voiceManager.addVoiceRoom(room.roomId, {
              widgetType: content.type || 'element-call',
              url: content.url,
              detected: new Date()
            });
          }
        }
      } catch (error) {
        this.logger.error(`Error handling event: ${error.message}`);
      }
    });

    // Log when synchronization is complete
    this.client.on('sync', (state, prevState, data) => {
      this.logger.info(`Sync state: ${state}`);
      if (state === 'PREPARED') {
        this.logger.info('Initial sync completed, bot is ready to respond to commands');
        // List rooms the bot is in and detect voice rooms
        const rooms = this.client.getRooms();
        this.logger.info(`Bot is in ${rooms.length} rooms:`);
        rooms.forEach(room => {
          try {
            const encrypted = this.isRoomEncrypted(room) ? "ENCRYPTED" : "unencrypted";
            this.logger.info(`- ${room.name} (${room.roomId}) - ${encrypted}`);
            
            // Check if this room has voice capabilities
            this.voiceManager.detectVoiceRoom(room);
          } catch (error) {
            this.logger.error(`Error checking room ${room.roomId}: ${error.message}`);
          }
        });
        
        // Log voice rooms detected
        const voiceRooms = this.voiceManager.getVoiceRooms();
        if (voiceRooms.size > 0) {
          this.logger.info(`Detected ${voiceRooms.size} voice rooms:`);
          for (const [roomId, info] of voiceRooms.entries()) {
            const room = this.client.getRoom(roomId);
            this.logger.info(`- ${room?.name || 'Unknown'} (${roomId}) - ${info.widgetType}`);
          }
        } else {
          this.logger.info('No voice rooms detected');
        }
      }
    });
  }
}

module.exports = { MatrixBot };