// src/call-info-command.js
export class CallInfoCommand {
    constructor(bot) {
      this.client = bot.client;
      this.logger = bot.logger;
      this.voiceManager = bot.voiceManager;
    }
  
    async execute(roomId, event, args) {
      const txnId = `callinfo-${Date.now()}`;
      
      try {
        const room = this.client.getRoom(roomId);
        if (!room) {
          await this.client.sendTextMessage(roomId, "Room not found", txnId);
          return;
        }
        
        // Check for call events
        const callEvents = room.currentState.getStateEvents('org.matrix.msc3401.call') || [];
        const callMemberEvents = room.currentState.getStateEvents('org.matrix.msc3401.call.member') || [];
        
        let info = "Call information for this room:\n";
        
        if (callEvents.length > 0) {
          info += `Found ${callEvents.length} MSC3401 call events:\n`;
          for (const callEvent of callEvents) {
            const content = callEvent.getContent();
            info += `- Call ID: ${callEvent.getStateKey() || 'unknown'}\n`;
            if (content.focus) {
              info += `  Focus type: ${content.focus.type || 'unknown'}\n`;
              info += `  Focus URL: ${content.focus.url || 'none'}\n`;
            }
          }
        } else {
          info += "No MSC3401 call events found\n";
        }
        
        if (callMemberEvents.length > 0) {
          info += `\nFound ${callMemberEvents.length} call member events:\n`;
          for (const memberEvent of callMemberEvents) {
            const userId = memberEvent.getStateKey();
            const content = memberEvent.getContent();
            
            info += `- User: ${userId}\n`;
            info += `  Call ID: ${content.call_id || 'none'}\n`;
            
            // Check both foci and foci_preferred fields
            const fociArray = content.foci || content.foci_preferred || [];
            if (fociArray && fociArray.length > 0) {
              info += `  Preferred foci: ${fociArray.length}\n`;
              for (const focus of fociArray) {
                // Handle both URL formats
                const url = focus.url || focus.livekit_service_url || 'none';
                info += `  Type: ${focus.type}, URL: ${url}\n`;
              }
            } else {
              info += `  Preferred foci: 0\n`;
            }
          }
        } else {
          info += "\nNo call member events found";
        }
        
        // Add information about bot's active calls
        if (this.voiceManager && this.voiceManager.activeCalls) {
          const isActive = this.voiceManager.activeCalls.has(roomId);
          if (isActive) {
            const callData = this.voiceManager.activeCalls.get(roomId);
            info += `\n\nBot is currently in a call in this room (joined at ${callData.joinedAt})`;
            if (callData.livekitParams) {
              info += `\nLiveKit room: ${callData.livekitParams.roomName}`;
              info += `\nLiveKit server: ${callData.livekitParams.server}`;
            }
          } else {
            info += "\n\nBot is not in a call in this room";
          }
        }
        
        await this.client.sendTextMessage(roomId, info, txnId);
      } catch (error) {
        this.logger.error(`Error getting call info: ${error.message}`);
        await this.client.sendTextMessage(roomId, `Error getting call info: ${error.message}`, txnId);
      }
    }
  }