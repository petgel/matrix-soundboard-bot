export class LeaveCommand {
  constructor(voiceManager, logger) {
    this.voiceManager = voiceManager;
    this.logger = logger;
  }

  async execute(roomId, event, args) {
    try {
      const result = await this.voiceManager.leaveCall(roomId);
      
      if (result.success) {
        return "Left the call.";
      } else {
        return result.error || "Not in a call in this room.";
      }
    } catch (error) {
      this.logger.error(`Leave call failed: ${error.message}`);
      return "Failed to leave the call: " + error.message;
    }
  }
}
