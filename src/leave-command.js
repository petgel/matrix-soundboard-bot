class LeaveCommand {
  constructor(voiceManager, logger) {
    this.voiceManager = voiceManager;
    this.logger = logger;
  }

  async handle(roomId) {
    try {
      if (!this.voiceManager.activeCalls.has(roomId)) {
        this.logger.info(`Not in a call in room ${roomId}`);
        return "Not in a call in this room.";
      }

      const callData = this.voiceManager.activeCalls.get(roomId);
      if (callData?.connection) {
        await callData.connection.disconnect();
      }

      this.voiceManager.activeCalls.delete(roomId);
      this.logger.info(`Left call in room ${roomId}`);
      return "Left the call.";
    } catch (error) {
      this.logger.error(`Leave call failed: ${error.message}`);
      return "Failed to leave the call.";
    }
  }

  async execute(roomId, event, args) {
    return await this.handle(roomId);
  }
}

export { LeaveCommand };
