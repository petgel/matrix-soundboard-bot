import fs from 'fs/promises';
import path from 'path';

export class PlayCommand {
  constructor({ client, logger, userId, mediaManager, voiceManager }) {
    this.client = client;
    this.logger = logger;
    this.userId = userId;
    this.mediaManager = mediaManager;
    this.voiceManager = voiceManager;
    this.soundsDir = path.join(process.cwd(), 'sounds');
  }

  async execute(roomId, event, args) {
    const soundName = args[0]?.toLowerCase();
    const baseTxnId = `play-${Date.now()}`;
    
    if (!soundName) {
      await this.client.sendTextMessage(roomId, "Please specify a sound name", `${baseTxnId}-1`);
      return;
    }

    try {
      // Use media manager to find sound with proper extension handling
      const sound = await this.mediaManager.getSound(soundName);
      if (!sound) {
        await this.client.sendTextMessage(roomId, `Sound not found: ${soundName}`, `${baseTxnId}-2`);
        return;
      }

      if (!this.voiceManager.activeCalls.has(roomId)) {
        await this.client.sendTextMessage(roomId, `Not in active call`, `${baseTxnId}-2`);
        return;
      }

      // Read sound file into buffer using validated path from media manager
      const soundBuffer = await fs.readFile(sound.path);
      this.logger.debug(`Loaded sound buffer`, {
        soundName,
        path: sound.path,
        bufferLength: soundBuffer.length
      });

      // Validate sound buffer before attempting playback
      if (!soundBuffer?.length) {
        await this.client.sendTextMessage(roomId, `Sound file "${soundName}" is empty or corrupted`, `${baseTxnId}-3`);
        return;
      }

      // Play sound using buffer
      const result = await this.voiceManager.playSound(roomId, soundBuffer);
      
      if (!result) {
        await this.client.sendTextMessage(roomId, `❌ Failed to play sound: No response from voice system`, `${baseTxnId}-4`);
        return;
      }

      if (result.success) {
        await this.client.sendTextMessage(roomId, `🔊 Playing "${soundName}" (${Math.round(result.duration/1000)}s)`, `${baseTxnId}-5`);
      } else {
      const errorMessage = result?.error 
          ? `${result.error.message || result.error}` 
          : 'Unknown error';
        await this.client.sendTextMessage(roomId, `❌ Failed to play sound: ${errorMessage}`, `${baseTxnId}-6`);
      }
    } catch (error) {
      this.logger.error(`Error playing sound`, {
        error: error.message,
        stack: error.stack,
        roomId,
        soundName
      });
      
      const errorMsg = error.code === 'ENOENT' 
        ? `Sound not found: ${soundName}`
        : `Failed to play sound: ${error.message}`;
      
      await this.client.sendTextMessage(
        roomId, 
        errorMsg, 
        `${baseTxnId}-5`
      );
    }
  }
}
