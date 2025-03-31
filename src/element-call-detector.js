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
      if (!rtcFoci) {
        this.logger.error('No rtc_foci found in .well-known');
        return null;
      }
      
      for (const foci of rtcFoci) {
        if (foci.type === 'livekit') {
          this.logger.info(`Found LiveKit JWT service URL: ${foci.livekit_service_url}`);
          return foci.livekit_service_url;
        }
      }
      this.logger.error('No LiveKit foci found in .well-known');
      return null;
    } catch (error) {
      this.logger.error(`Error discovering JWT service URL: ${error.message}`);
      // If .well-known fails, try a hardcoded fallback for testing
      return "https://livekit-jwt.call.element.io";
    }
  }

  async getLiveKitToken(jwtServiceUrl, matrixAccessToken, roomId, callId) {
    try {
      this.logger.info(`Getting LiveKit token from ${jwtServiceUrl} for room ${roomId}, call ${callId || 'none'}`);
      
      // Use room ID as call ID if not provided
      const effectiveCallId = callId || roomId.replace(/:/g, '_');
      
      const response = await axios.post(`${jwtServiceUrl}/api/v1/token`, {
        room_id: roomId,
        call_id: effectiveCallId
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${matrixAccessToken}`
        }
      });
      
      if (response.data && response.data.token) {
        this.logger.info(`LiveKit token obtained successfully`);
        return response.data.token;
      } else {
        this.logger.error(`Invalid token response: ${JSON.stringify(response.data)}`);
        return null;
      }
    } catch (error) {
      this.logger.error(`Error getting LiveKit token: ${error.message}`);
      if (error.response) {
        this.logger.error(`Response status: ${error.response.status}`);
        this.logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
      }
      return null;
    }
  }

  parseWidgetUrl(widgetUrl) {
    try {
      const url = new URL(widgetUrl);
      // Remove leading # from fragment and parse as URLSearchParams
      const fragment = url.hash.substring(1);
      const params = new URLSearchParams(fragment);
      
      const roomName = params.get('roomName') || params.get('r');
      const roomId = params.get('roomId');
      
      this.logger.info(`Parsed widget URL: server=${url.host}, roomName=${roomName}, roomId=${roomId}`);
      
      return {
        roomName: roomName,
        roomId: roomId,
        server: `${url.protocol}//${url.host}`
      };
    } catch (error) {
      this.logger.error(`Error parsing widget URL: ${error.message}`);
      return null;
    }
  }
  
  extractInfoFromCallMember(roomId, client) {
    try {
      const room = client.getRoom(roomId);
      if (!room) {
        this.logger.error(`Room not found: ${roomId}`);
        return null;
      }
      
      // Get call member events
      const callMemberEvents = room.currentState.getStateEvents('org.matrix.msc3401.call.member') || [];
      if (callMemberEvents.length === 0) {
        this.logger.info(`No call member events found in room ${roomId}`);
        return null;
      }
      
      this.logger.info(`Found ${callMemberEvents.length} call member events in room ${roomId}`);
      
      // Find our own call member event
      const myUserId = client.getUserId();
      const myCallMemberEvent = callMemberEvents.find(event => event.getStateKey() === myUserId);
      
      if (!myCallMemberEvent) {
        // If we don't have our own event, use the first one we find
        this.logger.info(`No call member event for our user ${myUserId}, using first available`);
        for (const event of callMemberEvents) {
          const content = event.getContent();
          const fociArray = content.foci || content.foci_preferred || [];
          
          if (fociArray && fociArray.length > 0) {
            const livekitFoci = fociArray.find(f => f.type === 'livekit');
            if (livekitFoci) {
              return {
                callId: content.call_id || roomId,
                livekitUrl: livekitFoci.url || livekitFoci.livekit_service_url,
                roomName: roomId.replace(/[^a-zA-Z0-9]/g, '')
              };
            }
          }
        }
      } else {
        // Use our own call member event
        const content = myCallMemberEvent.getContent();
        const fociArray = content.foci || content.foci_preferred || [];
        
        if (fociArray && fociArray.length > 0) {
          const livekitFoci = fociArray.find(f => f.type === 'livekit');
          if (livekitFoci) {
            return {
              callId: content.call_id || roomId,
              livekitUrl: livekitFoci.url || livekitFoci.livekit_service_url,
              roomName: roomId.replace(/[^a-zA-Z0-9]/g, '')
            };
          }
        }
      }
      
      this.logger.error(`No suitable LiveKit foci found in call member events`);
      return null;
    } catch (error) {
      this.logger.error(`Error extracting info from call member: ${error.message}`);
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