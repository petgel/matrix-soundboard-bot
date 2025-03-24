export class GrantCommand {
  constructor(client, logger, userId) {
    this.client = client;
    this.logger = logger;
    this.userId = userId;
  }

  async execute(roomId, event) {
    const room = this.client.getRoom(roomId);
    const sender = room.getMember(event.getSender());
    
    if (sender.powerLevel >= 100) {
      try {
        await this.client.setPowerLevel(this.userId, roomId, 100);
        await this.client.sendTextMessage(roomId, "✅ Granted soundboard bot required permissions");
      } catch (error) {
        this.logger.error(`Power level error: ${error.message}`);
        await this.client.sendTextMessage(roomId, `Failed to grant permissions: ${error.message}`);
      }
    } else {
      await this.client.sendTextMessage(roomId, "❌ You need power level 100+ to grant permissions");
    }
  }
}
