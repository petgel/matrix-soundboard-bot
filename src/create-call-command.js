// src/create-call-command.js
export class CreateCallCommand {
    constructor(client, logger) {
      this.client = client;
      this.logger = logger;
    }
  
    async execute(roomId, event, args) {
      const txnId = `createcall-${Date.now()}`;
      this.logger.info(`Creating voice call widget in room ${roomId}`);
  
      try {
        // Check if a call widget already exists
        const widgetEvents = this.client.getRoom(roomId).currentState.getStateEvents('m.widget') || [];
        for (const widgetEvent of widgetEvents) {
          const content = widgetEvent.getContent();
          if (content?.url?.includes('element-call')) {
            await this.client.sendTextMessage(roomId, "Room already has a voice call widget", txnId);
            return;
          }
        }
  
        // Create Element Call widget
        const widgetId = `element-call-${Date.now()}`;
        const widgetContent = {
          id: widgetId,
          type: "jitsi",
          url: "https://call.element.io/#/?roomId=" + encodeURIComponent(roomId),
          name: "Voice Call",
          data: {
            roomId: roomId
          }
        };
  
        // Send state event
        await this.client.sendStateEvent(roomId, 'm.widget', widgetContent, widgetId);
        await this.client.sendTextMessage(roomId, "✅ Voice call created! Use !play to play sounds", txnId);
        this.logger.info(`Created voice call widget in room ${roomId}`);
      } catch (error) {
        this.logger.error(`Error creating voice call widget: ${error.message}`);
        await this.client.sendTextMessage(roomId, `❌ Failed to create voice call: ${error.message}`, txnId);
      }
    }
  }