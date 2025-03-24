import fs from 'fs/promises';
import path from 'path';

export class SoundsCommand {
  constructor(bot) {
    this.bot = bot;
    this.soundsDir = path.join(process.cwd(), 'sounds');
    this.client = bot.client;
    this.logger = bot.logger;
  }

  async execute(roomId, event) {
    try {
      const files = await fs.readdir(this.soundsDir);
      const sounds = files.filter(f => f.endsWith('.mp3')).map(f => f.replace('.mp3', ''));
      
      if (sounds.length === 0) {
        await this.client.sendTextMessage(roomId, "No sounds available", 'm.text');
        return;
      }

      const soundList = `Available sounds (use !play <name>):\n${sounds.map((s, i) => `${i+1}. ${s}`).join('\n')}`;
      await this.client.sendTextMessage(roomId, `\`\`\`${soundList}\`\`\``, 'm.text');
    } catch (error) {
      this.logger.error(`Error listing sounds: ${error.message}`);
      await this.client.sendTextMessage(roomId, "Failed to retrieve sound list", 'm.text');
    }
  }
}
