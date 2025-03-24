export class HelpCommand {
  constructor(bot) {
    this.bot = bot;
    this.client = bot.client;
  }

  async execute(roomId, event) {
    const helpText = [
      "Available commands:",
      "!help - Show this help message",
      "!ping - Check bot responsiveness",
      "!rooms - List available voice rooms",
      "!call [room] - Join a voice call",
      "!hangup - Leave current call",
      "!sounds - List available sounds",
      "!play [sound] - Play a sound",
      "!stop - Stop current sound",
      "!voice - Voice room status",
      "!status - Bot system status"
    ].join('\n');

    await this.client.sendTextMessage(roomId, helpText);
  }
}
