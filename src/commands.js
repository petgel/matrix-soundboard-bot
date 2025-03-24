class CommandHandler {
    constructor(bot) {
      this.bot = bot;
      this.client = bot.client;
      this.voiceManager = bot.voiceManager;
      this.mediaManager = bot.mediaManager;
      this.logger = bot.logger;
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
          case '!voice':
            await this.handleVoiceCommand(roomId, args, sender);
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
      
      if (rooms.length === 0) {
        await this.client.sendTextMessage(roomId, "Bot is not in any rooms.");
        return;
      }
      
      let message = "Rooms the bot has joined:\n\n";
      
      rooms.forEach((room, index) => {
        // Get room details
        const roomId = room.roomId;
        const roomName = room.name || "Unnamed Room";
        const memberCount = room.getJoinedMembers().length;
        const isEncrypted = this.bot.isRoomEncrypted(room) ? "Yes" : "No";
        const isVoiceRoom = this.voiceManager.getVoiceRooms().has(roomId) ? "Yes" : "No";
        const isInCall = this.voiceManager.getActiveRooms().has(roomId) ? "Yes" : "No";
        
        // Check for widgets in the room
        const widgets = [];
        const widgetEvents = room.currentState.getStateEvents('m.widget');
        if (widgetEvents && widgetEvents.length > 0) {
          for (const event of widgetEvents) {
            const content = event.getContent();
            if (content && content.type) {
              widgets.push(content.type);
            } else if (content && content.url) {
              if (content.url.includes('element-call')) {
                widgets.push('element-call');
              } else {
                widgets.push('unknown widget');
              }
            }
          }
        }
        
        // Add room info to message
        message += `${index + 1}. ${roomName} (${roomId})\n`;
        message += `   Members: ${memberCount}\n`;
        message += `   Encrypted: ${isEncrypted}\n`;
        message += `   Voice Room: ${isVoiceRoom}\n`;
        message += `   In Call: ${isInCall}\n`;
        
        if (widgets.length > 0) {
          message += `   Widgets: ${widgets.join(', ')}\n`;
        }
        
        message += "\n";
      });
      
      message += "Use !call join to join a call in a voice room.";
      
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
          const success = await this.voiceManager.joinCall(roomId);
          if (success) {
            // Find the voice room we just joined
            const activeVoiceRooms = Array.from(this.voiceManager.getActiveRooms().keys())
              .filter(roomId => this.voiceManager.getVoiceRooms().has(roomId));
            
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
          const leftCall = await this.voiceManager.leaveCall();
          if (leftCall) {
            await this.client.sendTextMessage(roomId, "Left all active calls.");
          } else {
            await this.client.sendTextMessage(roomId, "Not in any calls.");
          }
          break;
          
        case 'status':
          const voiceRooms = this.voiceManager.getAvailableVoiceRooms();
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
          const result = await this.voiceManager.playSound(roomId, sound, this.mediaManager);
          
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
    
    async handleVoiceCommand(roomId, args, senderId) {
      if (!args.length) {
        await this.client.sendTextMessage(roomId, 
          "Voice room commands:\n" +
          "- !voice set <roomId> - Manually set a room as a voice room\n" +
          "- !voice clear <roomId> - Remove a room from voice rooms\n" +
          "- !voice list - List current voice rooms"
        );
        return;
      }
      
      const subCommand = args[0].toLowerCase();
      switch (subCommand) {
        case 'set':
          if (args.length < 2) {
            await this.client.sendTextMessage(roomId, "Please specify a room ID: !voice set <roomId>");
            return;
          }
          
          const targetRoomId = args[1];
          const targetRoom = this.client.getRoom(targetRoomId);
          
          if (!targetRoom) {
            await this.client.sendTextMessage(roomId, `Room not found: ${targetRoomId}`);
            return;
          }
          
          if (this.voiceManager.setVoiceRoom(targetRoomId)) {
            await this.client.sendTextMessage(roomId, `Room "${targetRoom.name}" (${targetRoomId}) is now set as a voice room.`);
          } else {
            await this.client.sendTextMessage(roomId, `Failed to set voice room: ${targetRoomId}`);
          }
          break;
          
        case 'clear':
          if (args.length < 2) {
            await this.client.sendTextMessage(roomId, "Please specify a room ID: !voice clear <roomId>");
            return;
          }
          
          const clearRoomId = args[1];
          const clearRoom = this.client.getRoom(clearRoomId);
          
          if (!this.voiceManager.getVoiceRooms().has(clearRoomId)) {
            await this.client.sendTextMessage(roomId, `Room is not set as a voice room: ${clearRoomId}`);
            return;
          }
          
          if (this.voiceManager.clearVoiceRoom(clearRoomId)) {
            await this.client.sendTextMessage(roomId, 
              `Room "${clearRoom?.name || clearRoomId}" (${clearRoomId}) is no longer set as a voice room.`);
          } else {
            await this.client.sendTextMessage(roomId, `Failed to clear voice room: ${clearRoomId}`);
          }
          break;
          
        case 'list':
          const voiceRooms = this.voiceManager.getAvailableVoiceRooms();
          
          if (voiceRooms.length === 0) {
            await this.client.sendTextMessage(roomId, "No voice rooms are currently set.");
            return;
          }
          
          let message = "Current voice rooms:\n\n";
          
          voiceRooms.forEach((room, index) => {
            message += `${index + 1}. ${room.name} (${room.roomId})\n`;
            message += `   Active: ${room.active ? "Yes" : "No"}\n\n`;
          });
          
          await this.client.sendTextMessage(roomId, message);
          break;
          
        default:
          await this.client.sendTextMessage(roomId, `Unknown voice command: ${subCommand}`);
      }
    }
    
    async showStatus(roomId) {
      const runtime = process.uptime();
      const hours = Math.floor(runtime / 3600);
      const minutes = Math.floor((runtime % 3600) / 60);
      const seconds = Math.floor(runtime % 60);
      
      const rooms = this.client.getRooms();
      const encryptedRooms = rooms.filter(room => this.bot.isRoomEncrypted(room)).length;
      
      // Voice room info
      const voiceRooms = this.voiceManager.getAvailableVoiceRooms();
      const activeRooms = voiceRooms.filter(room => room.active);
      
      const status = [
        `Bot status: Online`,
        `Uptime: ${hours}h ${minutes}m ${seconds}s`,
        `Connected to ${rooms.length} rooms (${encryptedRooms} encrypted)`,
        `Voice rooms: ${voiceRooms.length} detected`,
        `Active calls: ${activeRooms.length}`,
        `Sound files: ${(await this.mediaManager.listSounds()).length}`,
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
        "- !rooms - List all rooms the bot has joined with details",
        "- !voice set <roomId> - Manually set a room as a voice room",
        "- !voice clear <roomId> - Remove a room from voice rooms",
        "- !voice list - List current voice rooms",
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
  
  module.exports = { CommandHandler };