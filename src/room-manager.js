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
    rooms.forEach(room => {
      if (!this.isRoomEncrypted(room)) {
        this.voiceManager.detectVoiceRoom(room);
        if (room.name.toLowerCase().includes('sound')) {
          this.logger.info(`Setting sound room: ${room.name} (${room.roomId})`);
          this.voiceManager.setVoiceRoom(room.roomId, 'name-based');
        }
      }
    });
  }

  async handleRoomMembership(event, member) {
    if (member.userId === this.userId && member.membership === 'invite') {
      this.logger.info(`Joining room ${member.roomId}`);
      try {
        await this.client.joinRoom(member.roomId);
        setTimeout(async () => {
          const room = this.client.getRoom(member.roomId);
          if (room && this.isRoomEncrypted(room)) return;
          
          const me = room.getMember(this.userId);
          if (me && me.powerLevel >= 100) {
          await this.client.sendTextMessage(member.roomId, 
            "Hello! I'm a soundboard bot. I need 'Power Level 100' to function properly. " +
            "Please have a room admin run: !grant"
          );
          } else {
            this.logger.warn(`Not sending greeting - insufficient power level (${me?.powerLevel || 0})`);
          }
          this.voiceManager.detectVoiceRoom(room);
          if (room?.name.toLowerCase().includes('sound')) {
            this.voiceManager.setVoiceRoom(room.roomId, 'auto');
          }
        }, 2000);
      } catch (error) {
        this.logger.error(`Join error: ${error.message}`);
      }
    }
  }

  async handleRoomTimeline(event, room) {
    try {
      // Log every event
      this.logger.info(`Received event: ${JSON.stringify(event)}`);

      if (event?.getType() === 'm.room.message' && 
          event?.getSender() !== this.userId &&
          event?.getContent()?.msgtype === 'm.text') {
        
        if (!room || this.isRoomEncrypted(room)) return;
        await this.commandHandler.handleCommand(room?.roomId, event);
      }

      // Handle widget events with error protection
      try {
        if (event?.getType() === 'm.widget') {
          const content = event.getContent();
          this.logger.info(`Received m.widget event: ${JSON.stringify(content)}`);
          if (content?.url?.includes('element-call') && content?.type) {
            this.voiceManager.addVoiceRoom(room.roomId, {
              widgetType: content.type, // Keep this, might still be useful
              url: content.url,
              detected: new Date()
            });
            this.logger.debug('Processed widget event', {
              roomId: room.roomId,
              widgetType: content.type,
              url: content.url
            });
          }
        }
      } catch (error) {
        this.logger.error('Failed to process widget event', {
          error: error.message,
          eventType: event?.getType(),
          roomId: room?.roomId
        });
      }
    } catch (error) {
      this.logger.error(`Event error: ${error?.message || 'Unknown error'}`, {
        eventType: event?.getType(),
        roomId: room?.roomId,
        hasRoom: !!room,
        hasEvent: !!event,
        stack: error?.stack
      });
    }
  }

  handleSync(state, prevState, data) {
    if (state === 'PREPARED') {
      this.logger.info('Sync completed');
      const rooms = this.client.getRooms();
      rooms.forEach(room => {
        const encrypted = this.isRoomEncrypted(room) ? "ENCRYPTED" : "unencrypted";
        this.logger.info(`Room: ${room?.name || 'unnamed-room'} (${encrypted})`);
        this.voiceManager.detectVoiceRoom(room);
      });
      
      const voiceRooms = this.voiceManager.getVoiceRooms();
      if (voiceRooms.size > 0) {
        this.logger.info(`Voice rooms: ${voiceRooms.size}`);
      }
    }
  }
}
