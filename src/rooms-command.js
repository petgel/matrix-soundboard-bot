export class RoomsCommand {
  constructor(bot) {
    this.bot = bot;
    this.client = bot.client;
    this.logger = bot.logger;
  }

  isRoomEncrypted(room) {
    if (!room) return false;
    const encryptionEvent = room.currentState.getStateEvents('m.room.encryption', '');
    return !!encryptionEvent;
  }

  isElementCallRoom(room) {
    const widgetEvents = room.currentState.getStateEvents('m.widget');
    if (widgetEvents && widgetEvents.length > 0) {
      for (const event of widgetEvents) {
        const content = event.getContent();
        if (content?.url?.includes('element-call')) {
          return true;
        }
      }
    }

    const roomName = room.name?.toLowerCase();
    if (roomName?.includes('video') || roomName?.includes('call')) {
      return true;
    }

    return false;
  }

  async execute(roomId, event, args) {
    try {
      const rooms = this.client.getRooms();
      const roomList = rooms.map(room => {
        const encrypted = this.isRoomEncrypted(room) ? 'Yes' : 'No';
        const video = this.isElementCallRoom(room) ? 'Yes' : 'No';
        return `${room.name} // Encrypted: ${encrypted} // Video: ${video}`;
      });
      let message = `Rooms:\n${roomList.join('\n')}`;
      const txnId = `rooms-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      if (rooms.length > 0) {
        await this.client.sendEvent(roomId, 'm.room.message', {
          body: message,
          msgtype: 'm.text',
          format: 'org.matrix.custom.html',
          formatted_body: `<pre><code>${message}</code></pre>`
        }, txnId);
      } else {
        await this.client.sendEvent(roomId, 'm.room.message', {
          body: 'The bot is not in any rooms.',
          msgtype: 'm.text'
        }, txnId);
      }
    } catch (error) {
      this.logger.error(`Error listing rooms: ${error.message}`);
      const errorTxnId = `roomserror-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      await this.client.sendEvent(roomId, 'm.room.message', {
        body: `Error listing rooms: ${error.message}`,
        msgtype: 'm.text'
      }, errorTxnId);
    }
  }
}
