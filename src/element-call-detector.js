import { Room, RoomEvent, LocalTrack, AudioPresets } from 'livekit-client';
import axios from 'axios';

export class ElementCallDetector {
  constructor(logger) {
    this.logger = logger;
    this.activeCalls = new Map();
  }

  async getJwtServiceUrl(homeserverUrl) {
    try {
      const response = await axios.get(`${homeserverUrl}/.well-known/matrix/client`);
      const rtcFoci = response.data?.['org.matrix.msc4143.rtc_foci'];
      if (!rtcFoci) return null;
      
      for (const foci of rtcFoci) {
        if (foci.type === 'livekit') {
          return foci.livekit_service_url;
        }
      }
      return null;
    } catch (error) {
      this.logger.error(`Error discovering JWT service URL: ${error.message}`);
      return null;
    }
  }

  async getLiveKitToken(jwtServiceUrl, matrixAccessToken, roomId, callId) {
    try {
      const response = await axios.post(`${jwtServiceUrl}/api/v1/token`, {
        room_id: roomId,
        call_id: callId
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${matrixAccessToken}`
        }
      });
      
      return response.data?.token || null;
    } catch (error) {
      this.logger.error(`Error getting LiveKit token: ${error.message}`);
      return null;
    }
  }

  parseWidgetUrl(widgetUrl) {
    try {
      const url = new URL(widgetUrl);
      // Remove leading # from fragment and parse as URLSearchParams
      const fragment = url.hash.substring(1);
      const params = new URLSearchParams(fragment);
      
      return {
        roomName: params.get('roomName') || params.get('r'),
        roomId: params.get('roomId'),
        server: `${url.protocol}//${url.host}`
      };
    } catch (error) {
      this.logger.error(`Error parsing widget URL: ${error.message}`);
      return null;
    }
  }

  async connectToLiveKit(livekitUrl, token, roomName) {
    try {
      this.logger.info(`Connecting to LiveKit room: ${roomName} at ${livekitUrl}`);
      
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioPreset: AudioPresets.music
      });
      
      await room.connect(livekitUrl, token);
      this.logger.info(`Connected to LiveKit room: ${roomName}`);
      
      // Store the room
      this.activeCalls.set(roomName, {
        room,
        connectedAt: new Date(),
        tracks: []
      });
      
      room.on(RoomEvent.ParticipantConnected, participant => {
        this.logger.info(`Participant connected: ${participant.identity}`);
      });
      
      room.on(RoomEvent.Disconnected, () => {
        this.logger.info(`Disconnected from room: ${roomName}`);
        this.activeCalls.delete(roomName);
      });
      
      return room;
    } catch (error) {
      this.logger.error(`Error connecting to LiveKit: ${error.message}`);
      return null;
    }
  }

  async playAudioBuffer(roomName, audioBuffer) {
    try {
      const callData = this.activeCalls.get(roomName);
      if (!callData || !callData.room) {
        return { success: false, error: 'Not connected to room' };
      }
      
      // Create a track from audio buffer
      const audioTrack = await LocalTrack.createAudioTrack({
        deviceId: 'soundboard-virtual-device',
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false
      });
      
      // Publish the track
      await callData.room.localParticipant.publishTrack(audioTrack);
      
      // Store track reference
      callData.tracks.push(audioTrack);
      
      // Send audio data to track (simplified, real implementation would need audio processing)
      this.logger.info(`Published audio track to room ${roomName}`);
      
      return { 
        success: true, 
        duration: audioBuffer.length / 44100, // Approximate duration based on sample rate
        track: audioTrack
      };
    } catch (error) {
      this.logger.error(`Error playing audio in room ${roomName}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  disconnect(roomName) {
    const callData = this.activeCalls.get(roomName);
    if (callData && callData.room) {
      callData.room.disconnect();
      this.logger.info(`Disconnected from LiveKit room: ${roomName}`);
      this.activeCalls.delete(roomName);
      return true;
    }
    return false;
  }
}
