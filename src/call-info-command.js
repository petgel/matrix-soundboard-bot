// src/call-info-command.js
export class CallInfoCommand {
    constructor(client, logger) {
      this.client = client;
      this.logger = logger;
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
            info += `- Call ID: ${content.call_id || 'unknown'}\n`;
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
            const content = memberEvent.getContent();
            info += `- User: ${memberEvent.getStateKey()}\n`;
            info += `  Call ID: ${content.call_id || 'none'}\n`;
            if (content.foci_preferred && content.foci_preferred.length > 0) {
              info += `  Preferred foci: ${content.foci_preferred.length}\n`;
              for (const focus of content.foci_preferred) {
                info += `    Type: ${focus.type}, URL: ${focus.livekit_service_url || 'none'}\n`;
              }
            }
          }
        } else {
          info += "\nNo call member events found";
        }
        
        await this.client.sendTextMessage(roomId, info, txnId);
      } catch (error) {
        this.logger.error(`Error getting call info: ${error.message}`);
        await this.client.sendTextMessage(roomId, `Error getting call info: ${error.message}`, txnId);
      }
    }
  }