import { HelpCommand } from './help-command.js';
import { PingCommand } from './ping-command.js';
import { SoundsCommand } from './sounds-command.js';
import { PlayCommand } from './play-command.js';
import { StopCommand } from './stop-command.js';
import { GrantCommand } from './grant-command.js';
import { RoomsCommand } from './rooms-command.js';
import { LeaveCommand } from './leave-command.js';

export class CommandHandler {
  constructor({ client, logger, userId, mediaManager, voiceManager }) {
    this.client = client;
    this.logger = logger || console;
    this.userId = userId;
    this.mediaManager = mediaManager;
    this.voiceManager = voiceManager;
    this.commands = new Map();

    // Register commands with proper dependencies
    this.registerCommand('help', new HelpCommand({ client: this.client, logger: this.logger }));
    this.registerCommand('ping', new PingCommand({ client: this.client, logger: this.logger }));
    this.registerCommand('sounds', new SoundsCommand({ client: this.client, logger: this.logger }));
    this.registerCommand('play', new PlayCommand({
      client: this.client,
      logger: this.logger,
      userId: this.userId,
      mediaManager: this.mediaManager,
      voiceManager: this.voiceManager
    }));
    this.registerCommand('stop', new StopCommand({ client: this.client, logger: this.logger }));
    this.registerCommand('grant', new GrantCommand(this.client, this.logger, this.userId));
    this.registerCommand('rooms', new RoomsCommand({ client: this.client, logger: this.logger }));
    this.registerCommand('leave', new LeaveCommand(this.voiceManager, this.logger));
  }

  registerCommand(name, handler) {
    this.commands.set(name, handler);
  }

  async handleCommand(roomId, event) {
    if (!this.logger) {
      console.error('Logger not initialized in CommandHandler');
      return;
    }

    // Validate event structure
    if (!event?.getContent?.()?.body) {
      this.logger?.warn('Received malformed event', { event });
      return;
    }

    const content = event.getContent();
    const messageBody = content.body.trim();
    const [command, ...args] = messageBody.split(/\s+/);
    const isCommand = command?.startsWith('!') ?? false;

    // Add null checks for critical properties
    const sender = event.getSender?.() ?? 'unknown';

    this.logger.info({
      message: "Chat message received",
      roomId,
      sender: sender,
      messageType: isCommand ? "command" : "message",
      content: messageBody,
      ...(isCommand && {
        command: command?.slice(1) ?? 'unknown',  // Remove the '!' prefix with null check
        args: args,
        rawCommand: messageBody
      })
    });

    if (command?.startsWith?.('!')) {
      this.logger.info(`Identified command: ${command} with args: ${args.join(' ')}`);
      const handler = this.commands.get(command?.slice(1)?.toLowerCase());
      if (handler) {
        try {
          await handler.execute(roomId, event, args);
        } catch (error) {
          this.logger.error(`Error executing ${command}: ${error.message}`);
          const responseText = `Error processing command: ${error.message}`;
          await this.client.sendTextMessage(roomId, responseText);
          this.logger.info(`Sent error response to ${roomId}: "${responseText}"`);
        }
      }
    }
  }
}
