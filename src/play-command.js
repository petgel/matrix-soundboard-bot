import path from 'path';

export class PlayCommand {
  constructor(bot) {
    this.bot = bot;
    this.soundsDir = path.join(process.cwd(), 'sounds');
    this.client = bot.client;
    this.logger = bot.logger;
    this.mediaManager = bot.mediaManager;
  }

  async execute(roomId, event, args) {
    const soundName = args[0]?.toLowerCase();
    const baseTxnId = `play-${Date.now()}`;
    if (!soundName) {
      await this.client.sendTextMessage(roomId, "Please specify a sound name", `${baseTxnId}-1`);
      return;
    }

    
    try {
      const sound = await this.bot.mediaManager.getSound(soundName);
      if (!sound) {
        await this.client.sendTextMessage(roomId, `Sound not found: ${soundName}`, `${baseTxnId}-2`);
        return;
      }

      const result = await this.bot.voiceManager.playSound(roomId, sound, this.bot.mediaManager);
      if (result.success) {
        await this.client.sendTextMessage(roomId, result.simulated ? `Simulating playing sound: ${soundName}` : `Playing sound: ${soundName}`, `${baseTxnId}-3`);
      } else {
        await this.client.sendTextMessage(roomId, `Failed to play sound: ${result.error}`, `${baseTxnId}-4`);
      }
    } catch (error) {
      this.logger.error(`Error playing sound: ${error.message}`);
      await this.client.sendTextMessage(roomId, `Failed to play sound: ${error.message}`, `${baseTxnId}-5`);
    }
  }
}
