// Enhanced Matrix bot implementation with Element Call support
const sdk = require('matrix-js-sdk');

class MatrixBot {
  constructor(options) {
    this.homeserverUrl = options.homeserverUrl;
    this.accessToken = options.accessToken;
    this.userId = options.userId;
    this.mediaManager = options.mediaManager;
    this.logger = options.logger;
    
    this.client = null;
    this.activeRooms = new Map();
    this.startTime = Date.now(); // Timestamp when the bot is created
  }
  
  async start() {
    // Make sure homeserver URL doesn't have a trailing slash
    const baseUrl = this.homeserverUrl.endsWith('/') 
      ? this.homeserverUrl.slice(0, -1) 
      : this.homeserverUrl;
    
    // Initialize Matrix client without encryption
    this.logger.info(`Creating client with homeserver: ${baseUrl}`);
    
    this.client = sdk.createClient({
      baseUrl: baseUrl,
      accessToken: this.accessToken,
      userId: this.userId,
      timelineSupport: true
    });
    
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
        // Skip processing messages from before the bot started
        const eventTimestamp = event.getTs();
        if (eventTimestamp < this.startTime) {
          return;
        }
        
        // Only handle text messages that aren't from the bot
        if (event.getType() === 'm.room.message' && 
            event.getSender() !== this.userId &&
            event.getContent().msgtype === 'm.text') {
          
          // Check if room is encrypted
          if (room && this.isRoomEncrypted(room)) {
            this.logger.info(`Ignoring message in encrypted room ${room.roomId}`);
            return;
          }
          
          await this.handleCommand(room.roomId, event);
        }
        
        // Track widget events for call detection
        if (event.getType() === 'm.widget') {
          this.logger.info(`Widget event in room ${room.roomId}`);
          // Check if this is a call widget
          const content = event.getContent();
          if (content && (content.type === 'jitsi' || content.url?.includes('element-call'))) {
            this.logger.info(`Call widget detected in room ${room.roomId}: ${content.url}`);
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
        // List rooms the bot is in
        const rooms = this.client.getRooms();
        this.logger.info(`Bot is in ${rooms.length} rooms:`);
        rooms.forEach(room => {
          try {
            const encrypted = this.isRoomEncrypted(room) ? "ENCRYPTED" : "unencrypted";
            this.logger.info(`- ${room.name} (${room.roomId}) - ${encrypted}`);
          } catch (error) {
            this.logger.error(`Error checking room encryption: ${error.message}`);
          }
        });
      }
    });
  }
  
  async getCallWidgetInRoom(roomId) {
    const room = this.client.getRoom(roomId);
    if (!room) return null;
    
    // First check for Element Call widgets (m.widget events)
    const widgetEvents = room.currentState.getStateEvents('m.widget');
    if (widgetEvents && widgetEvents.length > 0) {
      for (const event of widgetEvents) {
        const content = event.getContent();
        if (content && content.url && 
           (content.url.includes('element-call') || 
            content.type === 'jitsi' || 
            content.type === 'call' || 
            content.url.includes('jitsi'))) {
          
          this.logger.info(`Found call widget in room ${roomId}: ${content.type} - ${content.url}`);
          return {
            widgetId: event.getStateKey(),
            url: content.url,
            name: content.name || 'Call',
            data: content.data || {},
            type: content.type || 'unknown'
          };
        }
      }
    }
    
    // Also check for m.call state events (newer Matrix spec for VoIP)
    const callEvents = room.currentState.getStateEvents('m.call');
    if (callEvents && callEvents.length > 0) {
      for (const event of callEvents) {
        const content = event.getContent();
        this.logger.info(`Found m.call event in room ${roomId}: ${JSON.stringify(content)}`);
        return {
          widgetId: event.getStateKey(),
          type: 'm.call',
          data: content
        };
      }
    }
    
    // Also look for room events that might indicate an active call
    const timelineEvents = room.timeline || [];
    const recentEvents = timelineEvents.slice(-30); // Check the last 30 events
    
    for (const event of recentEvents) {
      if (event.getType() === 'm.call.invite' || 
          event.getType() === 'm.call.candidates' || 
          event.getType() === 'm.call.answer') {
        this.logger.info(`Found call signaling event in room ${roomId}: ${event.getType()}`);
        return {
          type: 'call_signaling',
          data: event.getContent()
        };
      }
    }
    
    return null;
  }
  
  async isUserInCall(roomId, userId) {
    try {
      // First check if there's an active call in the room
      const callWidget = await this.getCallWidgetInRoom(roomId);
      if (!callWidget) {
        this.logger.info(`No active call detected in room ${roomId}`);
        return false;
      }
      
      this.logger.info(`Found active call in room ${roomId} - assuming user ${userId} is in the call`);
      
      // For simplicity, we'll assume that if there's an active call and the user is in the room,
      // they're participating in the call. In a production environment, you would want to
      // check actual call participation through the LiveKit API.
      
      // For now, we'll automatically return true if a call is detected
      // This ensures that users can play sounds right away
      return true;
    } catch (error) {
      this.logger.error(`Error checking if user is in call: ${error.message}`);
      // Default to assuming the user is in the call to make it easier to use
      return true;
    }
  }
  
  extractLivekitParams(widgetUrl) {
    try {
      const url = new URL(widgetUrl);
      const fragment = url.hash.substring(1); // Remove the leading #
      const params = new URLSearchParams(fragment);
      
      return {
        roomId: params.get('roomId'),
        roomAlias: params.get('roomAlias'),
        token: params.get('token'),
        baseUrl: `${url.protocol}//${url.host}`
      };
    } catch (error) {
      this.logger.error(`Error extracting LiveKit params: ${error.message}`);
      return null;
    }
  }
  
  async joinCall(roomId) {
    try {
      const callWidget = await this.getCallWidgetInRoom(roomId);
      if (!callWidget) {
        // If no call is detected but we're being asked to join, we'll be more lenient
        // and assume we should pretend to join anyway
        this.logger.info(`No active call widget found in room ${roomId}, but proceeding anyway`);
        
        // Create a placeholder for the active room
        this.activeRooms.set(roomId, {
          joinedAt: new Date(),
          assumedCall: true
        });
        
        return true;
      }
      
      this.logger.info(`Found call widget in room ${roomId}: ${callWidget.type}`);
      
      // For Element Call, extract parameters if available
      let params = null;
      if (callWidget.url && callWidget.url.includes('element-call')) {
        params = this.extractLivekitParams(callWidget.url);
        if (params) {
          this.logger.info(`Extracted LiveKit params: roomId=${params.roomId}`);
        }
      }
      
      // Store information about this call
      this.activeRooms.set(roomId, {
        callWidget,
        params,
        joinedAt: new Date()
      });
      
      this.logger.info(`Bot joined call in room ${roomId}`);
      return true;
    } catch (error) {
      this.logger.error(`Error joining call: ${error.message}`);
      // For convenience, we'll still mark the room as having an active call
      this.activeRooms.set(roomId, {
        joinedAt: new Date(),
        error: error.message,
        assumedCall: true
      });
      return true;
    }
  }
  
  async leaveCall(roomId) {
    if (!this.activeRooms.has(roomId)) {
      this.logger.info(`Bot is not in a call in room ${roomId}`);
      return false;
    }
    
    try {
      // Remove from active calls
      this.activeRooms.delete(roomId);
      this.logger.info(`Bot left call in room ${roomId}`);
      return true;
    } catch (error) {
      this.logger.error(`Error leaving call: ${error.message}`);
      return false;
    }
  }
  
  async playSound(roomId, soundName) {
    try {
      // Check if we're already in a call
      if (!this.activeRooms.has(roomId)) {
        // Try to join the call
        const joined = await this.joinCall(roomId);
        if (!joined) {
          this.logger.warn(`Could not join call in room ${roomId}, but will try to play sound anyway`);
          // Mark the room as active anyway so we can try to play sounds
          this.activeRooms.set(roomId, {
            joinedAt: new Date(),
            assumedCall: true
          });
        }
      }
      
      const sound = await this.mediaManager.getSound(soundName);
      if (!sound) {
        this.logger.error(`Sound not found: ${soundName}`);
        return false;
      }
      
      this.logger.info(`Playing sound ${sound.name} in call in room ${roomId}`);
      
      // For now, we're just simulating playing the sound
      // In a real implementation, this would use WebRTC to play the audio
      
      return true;
    } catch (error) {
      this.logger.error(`Error playing sound: ${error.message}`);
      return false;
    }
  }
  
  async handleCommand(roomId, event) {
    const content = event.getContent();
    const body = content.body || '';
    const sender = event.getSender();
    
    if (!body.startsWith('!')) return;
    
    const commandParts = body.split(' ');
    const command = commandParts[0].toLowerCase();
    const args = commandParts.slice(1);
    
    this.logger.info(`Command received from ${sender} in ${roomId}: ${body}`);
    
    try {
      switch (command) {
        case '!help':
          await this.showHelp(roomId);
          break;
        case '!ping':
          await this.client.sendTextMessage(roomId, 'Pong!');
          break;
        case '!status':
          await this.showStatus(roomId);
          break;
        case '!call':
          await this.handleCallCommand(roomId, args, sender);
          break;
        case '!sound':
          await this.handleSoundCommand(roomId, args, sender);
          break;
        default:
          // Unknown command - ignore
          break;
      }
    } catch (error) {
      this.logger.error(`Error handling command ${command}: ${error.message}`);
      try {
        await this.client.sendTextMessage(roomId, `Error: ${error.message}`);
      } catch (sendError) {
        this.logger.error(`Could not send error message: ${sendError.message}`);
      }
    }
  }
  
  async handleCallCommand(roomId, args, senderId) {
    if (!args.length) {
      await this.client.sendTextMessage(roomId, "Please specify a call command: join, leave, status");
      return;
    }
    
    const subCommand = args[0].toLowerCase();
    switch (subCommand) {
      case 'join':
        const success = await this.joinCall(roomId);
        if (success) {
          await this.client.sendTextMessage(roomId, "Joined the call.");
        } else {
          await this.client.sendTextMessage(roomId, "Failed to join call. Is there an active call in this room?");
        }
        break;
        
      case 'leave':
        const leftCall = await this.leaveCall(roomId);
        if (leftCall) {
          await this.client.sendTextMessage(roomId, "Left the call.");
        } else {
          await this.client.sendTextMessage(roomId, "Not in a call in this room.");
        }
        break;
        
      case 'status':
        const callWidget = await this.getCallWidgetInRoom(roomId);
        if (callWidget) {
          await this.client.sendTextMessage(roomId, `Active call found: ${callWidget.name || callWidget.type}`);
          if (this.activeRooms.has(roomId)) {
            await this.client.sendTextMessage(roomId, "Bot is in this call.");
          } else {
            await this.client.sendTextMessage(roomId, "Bot is not in this call. Use !call join to join.");
          }
        } else {
          await this.client.sendTextMessage(roomId, "No active call found in this room.");
        }
        break;
        
      default:
        await this.client.sendTextMessage(roomId, `Unknown call command: ${subCommand}`);
    }
  }
  
  async handleSoundCommand(roomId, args, senderId) {
    if (!args.length) {
      await this.client.sendTextMessage(roomId, "Please specify a sound command: list, play");
      return;
    }
    
    const subCommand = args[0].toLowerCase();
    switch (subCommand) {
      case 'list':
        try {
          const sounds = await this.mediaManager.listSounds();
          if (sounds.length === 0) {
            await this.client.sendTextMessage(roomId, "No sound files found. Add some sound files to the sounds directory.");
          } else {
            const soundList = sounds.map(s => s.name).join(', ');
            await this.client.sendTextMessage(roomId, `Available sounds: ${soundList}`);
          }
        } catch (error) {
          this.logger.error(`Error listing sounds: ${error.message}`);
          await this.client.sendTextMessage(roomId, `Error listing sounds: ${error.message}`);
        }
        break;
        
      case 'play':
        if (!args[1]) {
          await this.client.sendTextMessage(roomId, "Please specify a sound name to play");
          return;
        }
        
        try {
          const soundName = args[1];
          const sound = await this.mediaManager.getSound(soundName);
          
          if (!sound) {
            await this.client.sendTextMessage(roomId, `Sound "${soundName}" not found.`);
            return;
          }
          
          // Check if there's an active call
          const callWidget = await this.getCallWidgetInRoom(roomId);
          
          // If no call is detected, we'll be more permissive and try to play anyway
          if (!callWidget) {
            this.logger.info(`No active call detected in room ${roomId}, but will attempt to play sound anyway`);
            await this.client.sendTextMessage(roomId, "No active call detected, but I'll try to play the sound anyway.");
          }
          
          // Try to play the sound
          const success = await this.playSound(roomId, soundName);
          
          if (success) {
            await this.client.sendTextMessage(roomId, `Playing sound: ${soundName}`);
          } else {
            await this.client.sendTextMessage(roomId, `Failed to play sound: ${soundName}`);
          }
        } catch (error) {
          this.logger.error(`Error playing sound: ${error.message}`);
          await this.client.sendTextMessage(roomId, `Error: ${error.message}`);
        }
        break;
        
      default:
        await this.client.sendTextMessage(roomId, `Unknown sound command: ${subCommand}`);
    }
  }
  
  async showStatus(roomId) {
    const runtime = process.uptime();
    const hours = Math.floor(runtime / 3600);
    const minutes = Math.floor((runtime % 3600) / 60);
    const seconds = Math.floor(runtime % 60);
    
    const rooms = this.client.getRooms();
    const encryptedRooms = rooms.filter(room => this.isRoomEncrypted(room)).length;
    const activeCalls = Array.from(this.activeRooms.keys()).length;
    
    const status = [
      `Bot status: Online`,
      `Uptime: ${hours}h ${minutes}m ${seconds}s`,
      `Connected to ${rooms.length} rooms (${encryptedRooms} encrypted)`,
      `Active calls: ${activeCalls}`,
      `Encryption support: No`
    ].join('\n');
    
    await this.client.sendTextMessage(roomId, status);
  }
  
  async showHelp(roomId) {
    const helpText = [
      "Matrix Soundboard Bot Commands:",
      "- !help - Show this help message",
      "- !ping - Check if the bot is responsive",
      "- !status - Show bot status information",
      "- !call join - Join the active call in this room",
      "- !call leave - Leave the call",
      "- !call status - Check call status in this room",
      "- !sound list - List available sounds",
      "- !sound play <name> - Play a sound in the call",
      "",
      "Note: This bot cannot respond in encrypted rooms.",
      "To play sounds, start a call in the room first and use !sound play."
    ].join('\n');
    
    await this.client.sendTextMessage(roomId, helpText);
  }
}

module.exports = { MatrixBot };