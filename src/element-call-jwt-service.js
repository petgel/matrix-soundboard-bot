import axios from 'axios';

class ElementCallJwtService {
  constructor(logger) {
    this.logger = logger;
  }
  
  /**
   * Get a LiveKit token from the Element Call JWT service
   */
  async getLiveKitToken(matrixAccessToken, roomId, callId) {
    try {
      const jwtServiceUrl = await this.discoverJwtServiceUrl();
      if (!jwtServiceUrl) {
        this.logger.error('Could not discover JWT service URL');
        return null;
      }
      
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
  
  /**
   * Discover the JWT service URL from .well-known
   */
  async discoverJwtServiceUrl() {
    try {
      const homeserverUrl = process.env.MATRIX_HOMESERVER_URL;
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
}

export { ElementCallJwtService };
