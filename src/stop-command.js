export class StopCommand {
  constructor(bot) {
    this.bot = bot;
    this.client = bot.client;
    this.logger = bot.logger;
    this.mediaManager = bot.mediaManager;
  }

  async execute(roomId, event) {
    try {
      await this.mediaManager.stopSound(roomId);
      await this.client.sendTextMessage(roomId, "Playback stopped", 'm.text');
    } catch (error) {
      this.logger.error(`Error stopping sound: ${error.message}`);
      await this.client.sendTextMessage(roomId, "Nothing is playing", 'm.text');
    }
  }
}
