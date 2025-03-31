// src/help-command.js
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
      "!sounds - List available sounds",
      "!play [sound] - Play a sound",
      "!widgets - List widgets in this room",
      "!call-info - Show information about call events in this room",
      "!status - Bot system status",
      "!leave - Make the bot leave the current voice room",
      "!grant - Give the bot permission (admin only)"
    ].join('\n');

    const txnId = `help-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await this.client.sendEvent(roomId, 'm.room.message', {
      body: helpText,
      msgtype: 'm.text',
      format: 'org.matrix.custom.html',
      formatted_body: `<pre><code>${helpText}</code></pre>`
    }, txnId);
  }
}