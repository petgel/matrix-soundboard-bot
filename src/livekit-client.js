import { Room, LocalTrack, AudioPresets } from 'livekit-client';
import { AccessToken } from 'livekit-server-sdk';
import { createReadStream } from 'fs';
import { createAudioResource, createAudioPlayer } from '@discordjs/voice';
import { Transform } from 'stream';

class LiveKitClient {
  constructor(logger) {
    this.logger = logger;
    this.rooms = new Map(); // Track active room connections
    this.audioPlayers = new Map(); // Track active audio players
  }

  /**
   * Generate a LiveKit token for joining a room
   */
  generateToken(roomName, participantName, apiKey, apiSecret) {
    try {
      const token = new AccessToken(apiKey, apiSecret, {
        identity: participantName,
        name: participantName
      });
      token.addGrant({ 
        roomJoin: true, 
        room: roomName,
        canPublish: true,
        canSubscribe: true
      });
      return token.toJwt();
    } catch (error) {
      this.logger.error(`Error generating LiveKit token: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract LiveKit parameters from Element Call widget URL
   */
  extractLiveKitParams(widgetUrl) {
    try {
      const url = new URL(widgetUrl);
      const fragment = url.hash.substring(1); // Remove the leading #
      const params = new URLSearchParams(fragment);
      
      return {
        roomId: params.get('roomId'),
        roomName: params.get('roomName') || params.get('room') || params.get('r'),
        serverUrl: `${url.protocol}//${url.host}`,
      };
    } catch (error) {
      this.logger.error(`Error extracting LiveKit params: ${error.message}`);
      return null;
    }
  }

  /**
   * Connect to a LiveKit room
   */
  async connectToRoom(livekitUrl, token, roomName) {
    try {
      this.logger.info(`Connecting to LiveKit room: ${roomName}`);
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioPreset: AudioPresets.music
      });

      await room.connect(livekitUrl, token);
      this.logger.info(`Connected to LiveKit room: ${roomName}`);

      this.rooms.set(roomName, room);
      
      room.on(Room.Event.ParticipantConnected, participant => {
        this.logger.info(`Participant connected: ${participant.identity}`);
      });
      
      room.on(Room.Event.ParticipantDisconnected, participant => {
        this.logger.info(`Participant disconnected: ${participant.identity}`);
      });
      
      room.on(Room.Event.Disconnected, () => {
        this.logger.info(`Disconnected from room: ${roomName}`);
        this.rooms.delete(roomName);
      });

      return room;
    } catch (error) {
      this.logger.error(`Error connecting to LiveKit room: ${error.message}`);
      return null;
    }
  }

  /**
   * Play a sound file in a LiveKit room
   */
  async playSound(roomName, soundPath) {
    try {
      const room = this.rooms.get(roomName);
      if (!room) {
        this.logger.error(`Not connected to room: ${roomName}`);
        return false;
      }

      this.logger.info(`Creating audio track from: ${soundPath}`);
      const audioPlayer = createAudioPlayer();
      this.audioPlayers.set(roomName, audioPlayer);
      
      const resource = createAudioResource(soundPath);
      audioPlayer.play(resource);
      
      const audioStream = new Transform({
        transform(chunk, encoding, callback) {
          this.push(chunk);
          callback();
        }
      });
      
      const track = await LocalTrack.createAudioTrack({
        stream: audioStream
      });
      
      await room.localParticipant.publishTrack(track);
      
      audioPlayer.on('stateChange', (oldState, newState) => {
        if (newState.status === 'idle') {
          room.localParticipant.unpublishTrack(track);
          this.audioPlayers.delete(roomName);
          this.logger.info(`Finished playing sound in room: ${roomName}`);
        }
      });
      
      return true;
    } catch (error) {
      this.logger.error(`Error playing sound: ${error.message}`);
      return false;
    }
  }

  /**
   * Disconnect from a specific room
   */
  async disconnectFromRoom(roomName) {
    try {
      const room = this.rooms.get(roomName);
      if (!room) return false;
      
      const audioPlayer = this.audioPlayers.get(roomName);
      if (audioPlayer) {
        audioPlayer.stop();
        this.audioPlayers.delete(roomName);
      }
      
      room.disconnect();
      this.rooms.delete(roomName);
      this.logger.info(`Disconnected from room: ${roomName}`);
      return true;
    } catch (error) {
      this.logger.error(`Error disconnecting from room: ${error.message}`);
      return false;
    }
  }

  /**
   * Disconnect from all rooms
   */
  async disconnectFromAllRooms() {
    try {
      for (const [roomName, room] of this.rooms.entries()) {
        const audioPlayer = this.audioPlayers.get(roomName);
        if (audioPlayer) {
          audioPlayer.stop();
          this.audioPlayers.delete(roomName);
        }
        room.disconnect();
      }
      this.rooms.clear();
      return true;
    } catch (error) {
      this.logger.error(`Error disconnecting from all rooms: ${error.message}`);
      return false;
    }
  }
}

export { LiveKitClient };
