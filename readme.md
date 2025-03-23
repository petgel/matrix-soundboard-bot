# Matrix Soundboard Bot

A Matrix bot that joins Element Call sessions and plays sounds on command.

## Features

- Join Element Call rooms
- Play sound effects from a library
- Stream audio from YouTube videos
- Command-based interface in Matrix rooms

## Setup

1. Create a Matrix account for your bot
2. Get an access token for your bot
3. Configure the `.env` file with your credentials
4. Add sound files to the `sounds` directory (MP3 or WAV format)
5. Start the bot with `npm start`

## Commands

- `!help` - Show available commands
- `!join` - Join the active call in this room
- `!leave` - Leave the call
- `!sound list` - List available sounds
- `!sound play <name>` - Play a sound (bot will join call automatically)
- `!youtube <url>` - Play audio from a YouTube video

## Requirements

- Node.js 14+
- FFmpeg (for audio processing)