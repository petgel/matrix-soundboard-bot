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
    this.voiceRooms = new Map(); // Map to store detected voice rooms
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
              
              // Check if this is a voice room
              this.detectVoiceRoom(room);
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
          
          await this.handleCommand(room.roomId, event);
        }
        
        // Track widget events for call detection
        if (event.getType() === 'm.widget') {
          this.logger.info(`Widget event in room ${room.roomId}`);
          // Check if this is a call widget
          const content = event.getContent();
          if (content && (content.type === 'jitsi' || content.url?.includes('element-call'))) {
            this.logger.info(`Call widget detected in room ${room.roomId}: ${content.url}`);
            // Mark this as a voice room
            this.voiceRooms.set(room.roomId, {
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
            this.detectVoiceRoom(room);
          } catch (error) {
            this.logger.error(`Error checking room ${room.roomId}: ${error.message}`);
          }
        });
        
        // Log voice rooms detected
        if (this.voiceRooms.size > 0) {
          this.logger.info(`Detected ${this.voiceRooms.size} voice rooms:`);
          for (const [roomId, info] of this.voiceRooms.entries()) {
            const room = this.client.getRoom(roomId);
            this.logger.info(`- ${room?.name || 'Unknown'} (${roomId}) - ${info.widgetType}`);
          }
        } else {
          this.logger.info('No voice rooms detected');
        }
      }
    });
  }
  
  // Check if a room has voice capabilities and mark it as a voice room
  detectVoiceRoom(room) {
    if (!room) return false;
    
    // Look for call widgets in room state
    const widgetEvents = room.currentState.getStateEvents('m.widget');
    if (widgetEvents && widgetEvents.length > 0) {
      for (const event of widgetEvents) {
        const content = event.getContent();
        if (content && (content.type === 'jitsi' || (content.url && content.url.includes('element-call')))) {
          this.logger.info(`Detected voice room: ${room.name} (${room.roomId})`);
          this.voiceRooms.set(room.roomId, {
            widgetType: content.type || 'element-call',
            url: content.url,
            detected: new Date()
          });
          return true;
        }
      }
    }
    
    // Also check for m.call state events
    const stateEvents = room.currentState.getStateEvents();
    if (stateEvents) {
      for (const [eventType, eventsByStateKey] of Object.entries(stateEvents)) {
        if (eventType === 'm.call' || eventType.includes('call')) {
          for (const [stateKey, event] of Object.entries(eventsByStateKey)) {
            this.logger.info(`Detected call state event in room ${room.roomId}: ${eventType}`);
            this.voiceRooms.set(room.roomId, {
              widgetType: 'matrix-call',
              detected: new Date()
            });
            return true;
          }
        }
      }
    }
    
    return false;
  }
  
  async getCallWidgetInRoom(roomId) {
    const room = this.client.getRoom(roomId);
    if (!room) {
      this.logger.error(`Room not found: ${roomId}`);
      return null;
    }
    
    // Look for call widgets in room state
    const widgetEvents = room.currentState.getStateEvents('m.widget');
    if (!widgetEvents || widgetEvents.length === 0) {
      this.logger.info(`No widget events found in room ${roomId}`);
      return null;
    }
    
    // Find Element Call widget
    for (const event of widgetEvents) {
      const content = event.getContent();
      if (content && content.type === 'jitsi' || 
          (content && content.url && content.url.includes('element-call'))) {
        this.logger.info(`Found call widget: ${JSON.stringify(content, null, 2)}`);
        return {
          widgetId: event.getStateKey(),
          url: content.url,
          name: content.name || 'Call',
          data: content.data || {}
        };
      }
    }
    
    return null;
  }
  
  async isUserInCall(roomId, userId) {
    // This would ideally check if the user is actually in the call
    // For now, we'll assume the user is in the call if they're in the room
    // and there is an active call widget
    const callWidget = await this.getCallWidgetInRoom(roomId);
    return !!callWidget; 
  }
  
  extractLivekitParams(widgetUrl) {
    try {
      const url = new URL(widgetUrl);
      const fragment = url.hash.substring(1); // Remove the leading #
      const params = new URLSearchParams(fragment);
      
      return {
        roomId: params.get('roomId'),
        roomAlias: params.get('roomAlias') || params.get('room') || params.get('r'),
        token: params.get('token'),
        baseUrl: `${url.protocol}//${url.host}`
      };
    } catch (error) {
      this.logger.error(`Error extracting LiveKit params: ${error.message}`);
      return null;
    }
  }
  
  getAvailableVoiceRooms() {
    const voiceRoomIds = Array.from(this.voiceRooms.keys());
    return voiceRoomIds.map(roomId => {
      const room = this.client.getRoom(roomId);
      return {
        roomId,
        name: room?.name || 'Unknown',
        active: this.activeRooms.has(roomId)
      };
    });
  }
  
  async joinCall(requestRoomId) {
    try {
      // Check if this room itself is a voice room
      if (this.voiceRooms.has(requestRoomId)) {
        const room = this.client.getRoom(requestRoomId);
        this.logger.info(`Joining call in voice room: ${room.name} (${requestRoomId})`);
        
        // Find the call widget
        const callWidget = await this.getCallWidgetInRoom(requestRoomId);
        
        if (!callWidget) {
          this.logger.info(`No active call found in voice room ${requestRoomId}`);
          return false;
        }
        
        this.logger.info(`Found call widget in room ${requestRoomId}: ${callWidget.url}`);
        
        // Store information about this call
        this.activeRooms.set(requestRoomId, {
          callWidget,
          originRoomId: requestRoomId,
          joinedAt: new Date(),
          roomName: room.name
        });
        
        this.logger.info(`Bot joined call in room ${requestRoomId} (${room.name})`);
        return true;
      }
      
      // If not, look for available voice rooms
      const voiceRooms = this.getAvailableVoiceRooms();
      if (voiceRooms.length === 0) {
        this.logger.error('No voice rooms available');
        return false;
      }
      
      // Find the first available voice room
      const targetVoiceRoom = voiceRooms[0];
      const voiceRoomId = targetVoiceRoom.roomId;
      const room = this.client.getRoom(voiceRoomId);
      
      this.logger.info(`Joining call in voice room: ${room.name} (${voiceRoomId})`);
      
      // Find the call widget
      const callWidget = await this.getCallWidgetInRoom(voiceRoomId);
      
      if (!callWidget) {
        this.logger.info(`No active call found in voice room ${voiceRoomId}`);
        return false;
      }
      
      this.logger.info(`Found call widget in room ${voiceRoomId}: ${callWidget.url}`);
      
      // Store information about this call
      this.activeRooms.set(voiceRoomId, {
        callWidget,
        originRoomId: requestRoomId,
        joinedAt: new Date(),
        roomName: room.name
      });
      
      this.logger.info(`Bot joined call in room ${voiceRoomId} (${room.name})`);
      return true;
    } catch (error) {
      this.logger.error(`Error joining call: ${error.message}`);
      return false;
    }
  }
  
  async leaveCall(roomId) {
    // If a specific room is provided, leave that call
    if (roomId && this.activeRooms.has(roomId)) {
      try {
        this.activeRooms.delete(roomId);
        this.logger.info(`Bot left call in room ${roomId}`);
        return true;
      } catch (error) {
        this.logger.error(`Error leaving call in room ${roomId}: ${error.message}`);
        return false;
      }
    }
    
    // Otherwise, leave all active calls
    if (this.activeRooms.size === 0) {
      this.logger.info('Bot is not in any calls');
      return false;
    }
    
    try {
      const roomsLeft = [];
      for (const roomId of this.activeRooms.keys()) {
        this.activeRooms.delete(roomId);
        roomsLeft.push(roomId);
      }
      
      this.logger.info(`Bot left calls in rooms: ${roomsLeft.join(', ')}`);
      return true;
    } catch (error) {
      this.logger.error(`Error leaving calls: ${error.message}`);
      return false;
    }
  }
  
  async playSound(requestRoomId, soundName) {
    try {
      let targetRoomId;
      
      // Check if the request room is itself a voice room
      if (this.voiceRooms.has(requestRoomId)) {
        targetRoomId = requestRoomId;
      } else {
        // Otherwise find a voice room the bot is in
        const activeVoiceRooms = Array.from(this.activeRooms.keys())
          .filter(roomId => this.voiceRooms.has(roomId));
        
        if (activeVoiceRooms.length > 0) {
          // Use an active voice room
          targetRoomId = activeVoiceRooms[0];
        } else {
          // Try to join a call in an available voice room
          const joined = await this.joinCall(requestRoomId);
          if (!joined) {
            this.logger.error('Failed to join any voice rooms');
            return false;
          }
          
          // Find the voice room we just joined
          const activeVoiceRooms = Array.from(this.activeRooms.keys())
            .filter(roomId => this.voiceRooms.has(roomId));
          
          if (activeVoiceRooms.length === 0) {
            this.logger.error('Failed to find the joined voice room');
            return false;
          }
          
          targetRoomId = activeVoiceRooms[0];
        }
      }
      
      // Make sure we have a valid voice room
      if (!targetRoomId) {
        this.logger.error('No target voice room found');
        return false;
      }
      
      const room = this.client.getRoom(targetRoomId);
      if (!room) {
        this.logger.error(`Voice room not found: ${targetRoomId}`);
        return false;
      }
      
      const sound = await this.mediaManager.getSound(soundName);
      if (!sound) {
        this.logger.error(`Sound not found: ${soundName}`);
        return false;
      }
      
      this.logger.info(`Playing sound ${sound.name} in room ${targetRoomId} (${room.name})`);
      
      // For now, we're just simulating playing the sound
      // In a real implementation, this would use WebRTC to play the audio
      
      return {
        success: true,
        roomId: targetRoomId,
        roomName: room.name
      };
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
        case '!rooms':
          await this.showRooms(roomId);
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
  
  async showRooms(roomId) {
    const rooms = this.client.getRooms();
    const voiceRooms = this.getAvailableVoiceRooms();
    
    if (voiceRooms.length === 0) {
      await this.client.sendTextMessage(roomId, "No voice rooms detected. I need to be invited to rooms with voice capabilities.");
      return;
    }
    
    let message = "Available voice rooms:\n";
    
    voiceRooms.forEach((room, index) => {
      const status = room.active ? "Active (bot in call)" : "Inactive";
      message += `${index + 1}. ${room.name} - ${status}\n`;
    });
    
    message += "\nUse !call join to join a call in one of these rooms.";
    
    await this.client.sendTextMessage(roomId, message);
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
          // Find the voice room we just joined
          const activeVoiceRooms = Array.from(this.activeRooms.keys())
            .filter(roomId => this.voiceRooms.has(roomId));
          
          if (activeVoiceRooms.length > 0) {
            const voiceRoomId = activeVoiceRooms[0];
            const voiceRoom = this.client.getRoom(voiceRoomId);
            await this.client.sendTextMessage(roomId, `Joined the call in ${voiceRoom.name}.`);
          } else {
            await this.client.sendTextMessage(roomId, "Joined a call.");
          }
        } else {
          await this.client.sendTextMessage(roomId, "Failed to join call. Is there an active call in any voice room?");
        }
        break;
        
      case 'leave':
        const leftCall = await this.leaveCall();
        if (leftCall) {
          await this.client.sendTextMessage(roomId, "Left all active calls.");
        } else {
          await this.client.sendTextMessage(roomId, "Not in any calls.");
        }
        break;
        
      case 'status':
        const voiceRooms = this.getAvailableVoiceRooms();
        const activeRooms = voiceRooms.filter(room => room.active);
        
        if (activeRooms.length === 0) {
          await this.client.sendTextMessage(roomId, "Bot is not in any calls.");
        } else {
          let message = "Bot is in calls in the following rooms:\n";
          activeRooms.forEach((room, index) => {
            message += `${index + 1}. ${room.name}\n`;
          });
          await this.client.sendTextMessage(roomId, message);
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
        const sounds = await this.mediaManager.listSounds();
        if (sounds.length === 0) {
          await this.client.sendTextMessage(roomId, "No sound files found. Add some sound files to the sounds directory.");
        } else {
          const soundList = sounds.map(s => s.name).join(', ');
          await this.client.sendTextMessage(roomId, `Available sounds: ${soundList}`);
        }
        break;
        
      case 'play':
        if (!args[1]) {
          await this.client.sendTextMessage(roomId, "Please specify a sound name to play");
          return;
        }
        
        const soundName = args[1];
        const sound = await this.mediaManager.getSound(soundName);
        
        if (!sound) {
          await this.client.sendTextMessage(roomId, `Sound "${soundName}" not found.`);
          return;
        }
        
        // Try to play the sound in a voice room
        await this.client.sendTextMessage(roomId, `Trying to play sound: ${soundName}...`);
        const result = await this.playSound(roomId, soundName);
        
        if (result && result.success) {
          await this.client.sendTextMessage(roomId, `Playing sound ${soundName} in ${result.roomName}.`);
        } else {
          await this.client.sendTextMessage(roomId, 
            `Failed to play sound: ${soundName}. ` +
            `No active voice calls found. Use !rooms to see available voice rooms.`);
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
    
    // Voice room info
    const voiceRooms = this.getAvailableVoiceRooms();
    const activeRooms = voiceRooms.filter(room => room.active);
    
    const status = [
      `Bot status: Online`,
      `Uptime: ${hours}h ${minutes}m ${seconds}s`,
      `Connected to ${rooms.length} rooms (${encryptedRooms} encrypted)`,
      `Voice rooms: ${voiceRooms.length} detected`,
      `Active calls: ${activeRooms.length}`,
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
      "- !rooms - List voice rooms the bot can access",
      "- !call join - Join a call in an available voice room",
      "- !call leave - Leave all active calls",
      "- !call status - Check which calls the bot is in",
      "- !sound list - List available sounds",
      "- !sound play <name> - Play a sound in an active call",
      "",
      "Note: This bot cannot respond in encrypted rooms.",
      "To play sounds, the bot must be invited to a room with voice capabilities."
    ].join('\n');
    
    await this.client.sendTextMessage(roomId, helpText);
  }
}

module.exports = { MatrixBot };