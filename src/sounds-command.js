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
        const noSoundsTxnId = `soundsempty-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        await this.client.sendEvent(roomId, 'm.room.message', {
          body: "No sounds available",
          msgtype: 'm.text'
        }, noSoundsTxnId);
        return;
      }

      const soundList = `Available sounds (use !play <name>):\n${sounds.map((s, i) => `${i+1}. ${s}`).join('\n')}`;
      
      // Generate unique transaction ID
      const txnId = `soundlist-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      
      await this.client.sendEvent(roomId, 'm.room.message', {
        body: soundList,
        msgtype: 'm.text',
        format: 'org.matrix.custom.html',
        formatted_body: `<pre><code>${soundList}</code></pre>`
      }, txnId);
    } catch (error) {
      this.logger.error(`Error listing sounds: ${error.message}`);
      
      // Generate unique transaction ID for error message
      const errorTxnId = `sounderror-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      
      await this.client.sendEvent(roomId, 'm.room.message', {
        body: "Failed to retrieve sound list",
        msgtype: 'm.text'
      }, errorTxnId);
    }
  }
}
