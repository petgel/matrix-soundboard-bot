import { HelpCommand } from './help-command.js';
import { PingCommand } from './ping-command.js';
import { SoundsCommand } from './sounds-command.js';
import { PlayCommand } from './play-command.js';
import { StopCommand } from './stop-command.js';
import { GrantCommand } from './grant-command.js';

export class CommandHandler {
  constructor(bot) {
    this.bot = bot;
    this.client = bot.client;
    this.logger = bot.logger;
    this.commands = new Map();

    // Register commands
    this.registerCommand('help', new HelpCommand(bot));
    this.registerCommand('ping', new PingCommand(bot));
    this.registerCommand('sounds', new SoundsCommand(bot));
    this.registerCommand('play', new PlayCommand(bot));
    this.registerCommand('stop', new StopCommand(bot));
    this.registerCommand('grant', new GrantCommand(bot.client, bot.logger, bot.userId));
  }

  registerCommand(name, handler) {
    this.commands.set(name, handler);
  }

  async handleCommand(roomId, event) {
    const content = event.getContent();
    const [command, ...args] = content.body.trim().split(/\s+/);
    
    if (command.startsWith('!')) {
      const handler = this.commands.get(command.slice(1).toLowerCase());
      if (handler) {
        try {
          await handler.execute(roomId, event, args);
        } catch (error) {
          this.logger.error(`Error executing ${command}: ${error.message}`);
          await this.client.sendTextMessage(roomId, `Error processing command: ${error.message}`);
        } finally {
          // Catch any errors during event sending
          const txnId = `m.${Date.now()}`;
          this.client.sendTextMessage(roomId, `Command processed (may have failed): ${command}`, txnId).catch(e => {
            this.logger.error(`Error sending message after command: ${e.message}`);
          });
        }
      }
    }
  }
}
