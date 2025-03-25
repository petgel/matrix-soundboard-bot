// src/room-manager.js
export class RoomManager {
  constructor(client, logger, voiceManager, commandHandler, userId) {
    this.client = client;
    this.logger = logger;
    this.voiceManager = voiceManager;
    this.commandHandler = commandHandler;
    this.userId = userId;
  }

  isRoomEncrypted(room) {
    if (!room) return false;
    const encryptionEvent = room.currentState.getStateEvents('m.room.encryption', '');
    return !!encryptionEvent;
  }

  processExistingRooms() {
    if (!this.client) {
      throw new Error('Matrix client not initialized');
    }
    
    const rooms = this.client.getRooms();
    this.logger.info(`Processing ${rooms.length} existing rooms`);
    
    rooms.forEach(room => {
      if (!this.isRoomEncrypted(room)) {
        this.logger.info(`Checking room for voice capabilities: ${room.name || 'unnamed'} (${room.roomId})`);
        
        // Check for voice capabilities
        setTimeout(() => {
          this.voiceManager.getCallWidget(room.roomId).then(widget => {
            if (widget) {
              this.logger.info(`Found voice widget in room: ${room.name || 'unnamed'} (${room.roomId})`);
              
              // Don't auto-join all rooms, instead just identify them
              // this.voiceManager.joinCall(room.roomId);
            }
          }).catch(err => {
            this.logger.error(`Error checking room for widgets: ${err.message}`);
          });
        }, 1000);
      } else {
        this.logger.info(`Skipping encrypted room: ${room.name || 'unnamed'} (${room.roomId})`);
      }
    });
    
    // Schedule voice room detection after initial processing
    setTimeout(() => this.detectVoiceRooms(), 5000);
  }

  async detectVoiceRooms() {
    const rooms = this.client.getRooms();
    this.logger.info(`Scanning ${rooms.length} rooms for voice capabilities`);
    
    for (const room of rooms) {
      try {
        if (this.isRoomEncrypted(room)) continue;
        
        const callWidget = await this.voiceManager.getCallWidget(room.roomId);
        if (callWidget) {
          this.logger.info(`Detected voice room: ${room.name || 'unnamed'} (${room.roomId})`);
          
          // Don't auto-join, just identify
          // Uncomment to auto-join if needed
          /*
          this.voiceManager.joinCall(room.roomId).catch(err => {
            this.logger.error(`Failed to join call in ${room.roomId}: ${err.message}`);
          });
          */
        }
      } catch (error) {
        this.logger.error(`Error checking room ${room.roomId}: ${error.message}`);
      }
    }
  }

  async handleRoomMembership(event, member) {
    if (member.userId === this.userId && member.membership === 'invite') {
      this.logger.info(`Received invite to room ${member.roomId}`);
      try {
        await this.client.joinRoom(member.roomId);
        this.logger.info(`Successfully joined room ${member.roomId}`);
        
        setTimeout(async () => {
          const room = this.client.getRoom(member.roomId);
          if (!room) {
            this.logger.error(`Room not found after joining: ${member.roomId}`);
            return;
          }
          
          if (this.isRoomEncrypted(room)) {
            this.logger.info(`Skipping encrypted room: ${room.name || 'unnamed'}`);
            return;
          }
          
          const me = room.getMember(this.userId);
          if (!me) {
            this.logger.error(`Cannot find self in room ${member.roomId}`);
            return;
          }
          
          // Check power level before sending greeting
          const powerLevel = me.powerLevel || 0;
          if (powerLevel < 50) {
            await this.client.sendTextMessage(member.roomId, 
              "Hello! I'm a soundboard bot. I need 'Power Level 50+' to function properly. " +
              "Please have a room admin run: !grant"
            );
            this.logger.info(`Sent greeting to room ${member.roomId} (power level: ${powerLevel})`);
          }
          
          // Check for voice capabilities
          const callWidget = await this.voiceManager.getCallWidget(member.roomId);
          if (callWidget) {
            this.logger.info(`Found voice widget in room ${member.roomId}`);
            this.client.sendTextMessage(member.roomId, 
              "I detected that this room has voice capabilities. Use !play [sound] to play sounds in the call."
            );
          }
        }, 2000);
      } catch (error) {
        this.logger.error(`Failed to join room ${member.roomId}: ${error.message}`);
      }
    }
  }

  async handleRoomTimeline(event, room) {
    try {
      // Only process message events from others
      if (event?.getType() === 'm.room.message' && 
          event?.getSender() !== this.userId &&
          event?.getContent()?.msgtype === 'm.text') {
        
        if (!room) {
          this.logger.error('Received event with no room reference');
          return;
        }
        
        if (this.isRoomEncrypted(room)) {
          this.logger.debug(`Ignoring message in encrypted room: ${room.roomId}`);
          return;
        }
        
        await this.commandHandler.handleCommand(room.roomId, event);
      }

      // Process widget events to detect voice rooms
      if (event?.getType() === 'm.widget' || event?.getType() === 'im.vector.modular.widgets') {
        try {
          const content = event.getContent();
          if (content?.url?.includes('element-call')) {
            this.logger.info(`Detected Element Call widget in room ${room.roomId}`);
            
            // Don't auto-join on widget detection, but log it
            // this.voiceManager.joinCall(room.roomId);
          }
        } catch (widgetError) {
          this.logger.error(`Error processing widget event: ${widgetError.message}`);
        }
      }
      
      // Process MSC3401 call events
      if (event?.getType() === 'org.matrix.msc3401.call') {
        try {
          this.logger.info(`Detected MSC3401 call event in room ${room.roomId}`);
          const content = event.getContent();
          if (content?.focus?.url) {
            this.logger.info(`Found call URL: ${content.focus.url}`);
            
            // Don't auto-join on call detection, but log it
            // this.voiceManager.joinCall(room.roomId);
          }
        } catch (callError) {
          this.logger.error(`Error processing call event: ${callError.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Error handling room timeline event: ${error.message}`, {
        roomId: room?.roomId,
        eventType: event?.getType(),
        stack: error.stack
      });
    }
  }

  handleSync(state, prevState, data) {
    if (state === 'PREPARED' && prevState !== 'PREPARED') {
      this.logger.info('Initial sync completed');
      
      // Process existing rooms after sync is ready
      setTimeout(() => {
        this.processExistingRooms();
      }, 2000);
    }
    
    // Log other sync state changes
    if (state !== prevState) {
      this.logger.info(`Sync state changed: ${prevState} -> ${state}`);
    }
  }
}