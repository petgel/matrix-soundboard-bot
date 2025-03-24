export class PingCommand {
  constructor(bot) {
    this.client = bot.client;
  }

  async execute(roomId, event) {
    await this.client.sendTextMessage(roomId, "Pong!", 'm.text');
  }
}
