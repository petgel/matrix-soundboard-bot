// src/widgets-command.js
export class WidgetsCommand {
    constructor(client, logger) {
      this.client = client;
      this.logger = logger;
    }
  
    async execute(roomId, event, args) {
      const txnId = `widgets-${Date.now()}`;
      
      try {
        const room = this.client.getRoom(roomId);
        if (!room) {
          await this.client.sendTextMessage(roomId, "Room not found", txnId);
          return;
        }
        
        // Check for all widgets
        const widgetEvents = room.currentState.getStateEvents('m.widget') || [];
        const modularWidgetEvents = room.currentState.getStateEvents('im.vector.modular.widgets') || [];
        const allWidgetEvents = [...widgetEvents, ...modularWidgetEvents];
        
        if (allWidgetEvents.length === 0) {
          await this.client.sendTextMessage(roomId, "No widgets found in this room", txnId);
          return;
        }
        
        // Format widget list
        let widgetList = "Widgets in this room:\n";
        for (const event of allWidgetEvents) {
          const content = event.getContent();
          const widgetId = event.getStateKey();
          const widgetUrl = content.url || content.data?.url || 'No URL';
          widgetList += `- ${content.name || 'Unnamed'} (${widgetId})\n  URL: ${widgetUrl}\n`;
        }
        
        await this.client.sendTextMessage(roomId, widgetList, txnId);
      } catch (error) {
        this.logger.error(`Error listing widgets: ${error.message}`);
        await this.client.sendTextMessage(roomId, `Error listing widgets: ${error.message}`, txnId);
      }
    }
  }