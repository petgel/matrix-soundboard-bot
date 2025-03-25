export class PingCommand {
  constructor(bot) {
    this.client = bot.client;
  }

  async execute(roomId, event) {
    const txnId = `ping-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await this.client.sendEvent(roomId, 'm.room.message', {
      body: 'Pong! 🏓',
      msgtype: 'm.text',
      format: 'org.matrix.custom.html',
      formatted_body: '<strong>Pong!</strong> 🏓'
    }, txnId);
  }
}
