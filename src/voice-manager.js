class VoiceManager {
    constructor(matrixClient, logger) {
      this.client = matrixClient;
      this.logger = logger;
      this.voiceRooms = new Map(); // Map to store detected voice rooms
      this.activeRooms = new Map(); // Tracks rooms where bot is in call
    }
    
    // Add a room to the voice rooms map
    addVoiceRoom(roomId, voiceInfo) {
      this.voiceRooms.set(roomId, voiceInfo);
    }
    
    // Get the map of voice rooms
    getVoiceRooms() {
      return this.voiceRooms;
    }
    
    // Get the map of active rooms (where bot is in call)
    getActiveRooms() {
      return this.activeRooms;
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
    
    async playSound(requestRoomId, sound, mediaManager) {
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
    
    setVoiceRoom(roomId, type = 'manual') {
      const room = this.client.getRoom(roomId);
      if (!room) {
        this.logger.error(`Room not found: ${roomId}`);
        return false;
      }
      
      this.voiceRooms.set(roomId, {
        widgetType: type,
        detected: new Date()
      });
      
      this.logger.info(`Manually set voice room: ${room.name} (${roomId})`);
      return true;
    }
    
    clearVoiceRoom(roomId) {
      if (!this.voiceRooms.has(roomId)) {
        return false;
      }
      
      this.voiceRooms.delete(roomId);
      
      // If we're in a call in this room, leave it
      if (this.activeRooms.has(roomId)) {
        this.activeRooms.delete(roomId);
      }
      
      return true;
    }
  }
  
  module.exports = { VoiceManager }; 