import { LiveKitClient } from './livekit-client.js';
import { ElementCallJwtService } from './element-call-jwt-service.js';

class VoiceManager {
    constructor(client, logger, voiceRoomId, mediaConfig) {
        this.client = client;
        this.logger = logger;
        this.voiceRoomId = voiceRoomId;
        this.mediaConfig = mediaConfig;
        this.livekitClient = new LiveKitClient();
        this.jwtService = new ElementCallJwtService();
        this.activeCalls = new Map();
    }

    async getCallWidget(roomId) {
        if (!roomId) {
            this.logger.error('getCallWidget called without roomId');
            return null;
        }
        const room = this.client.getRoom(roomId);
        if (!room) {
            this.logger.error(`Room not found: ${roomId}`);
            return null;
        }

        // Check both widget event types and newer modular widgets
        const widgetEvents = [
            ...room.currentState.getStateEvents('m.widget'),
            ...room.currentState.getStateEvents('im.vector.modular.widgets')
        ];

        // Find Element Call widget by URL pattern with broader matching
        for (const event of widgetEvents) {
            const content = event.getContent();
            this.logger.info(`Widget event content: ${JSON.stringify(content)}`); // Log the content
            const widgetUrl = content.url || content.data?.url;

            if (widgetUrl?.includes('element-call')) {
                this.logger.info(`Found potential Element Call widget: ${widgetUrl}`);
                return {
                    widgetId: event.getStateKey(),
                    url: widgetUrl,
                    name: content.name || 'Element Call',
                    data: content.data || {}
                };
            } else {
              this.logger.info(`Non-Element Call widget found: ${widgetUrl}`);
            }
        }

        this.logger.info(`No Element Call widgets found in room ${roomId}`);
        return null;
    }

    async joinCall(roomId) {
        try {
            // Force rejoin every time
            // if (this.activeCalls.has(roomId)) {
            //     return true; // Already joined
            // }

            const room = this.client.getRoom(roomId);
            if (!room) {
                this.logger.error(`Room not found: ${roomId}`);
                return false;
            }

            if (!room) {
                this.logger.error(`Room not found: ${roomId}`);
                return false;
            }

            if (this.activeCalls.has(roomId)) {
                this.logger.info(`Already in call in room ${roomId}`);
                return true;
            }

            let callWidget;
            for (let attempt = 1; attempt <= 3; attempt++) {
                callWidget = await this.getCallWidget(roomId);
                if (callWidget) break;

                this.logger.info(`Call widget not found (attempt ${attempt}), retrying...`);
                await new Promise(resolve => setTimeout(resolve, attempt * 1000));
            }

            if (!callWidget) {
                this.logger.error(`No call widget found in ${roomId} after 3 attempts`);
                return false;
            }

            // Extract LiveKit params from widget URL
            const livekitParams = this.livekitClient.parseWidgetUrl(callWidget.url);
            if (!livekitParams) {
                this.logger.error('Failed to extract LiveKit parameters');
                return false;
            }

            // Get JWT token for LiveKit
            const token = await this.jwtService.getLiveKitToken(
                this.client.getAccessToken(),
                roomId,
                livekitParams.roomName
            );

            if (!token) {
                this.logger.error('Failed to get LiveKit token');
                return false;
            }

            // Connect to LiveKit
            const connection = await this.livekitClient.connect(
                livekitParams.server,
                token,
                livekitParams.roomName
            );

            if (!connection) {
                return false;
            }

            this.activeCalls.set(roomId, {
                connection,
                joinedAt: new Date(),
                widget: callWidget
            });

            return true;
        } catch (error) {
            this.logger.error(`Join call failed: ${error.message}`);
            return false;
        }
    }

    async detectVoiceRoom(maxAttempts = 3, delayMs = 5000) {
        if (!this.client?.getRooms) {
            this.logger.error('Client not initialized');
            return null;
        }
        let attempt = 1;
        const maxAttemptsNumber = Number(maxAttempts) || 3;
        const baseDelay = Math.max(Number(delayMs) || 5000, 1000);
        
        while (attempt <= maxAttemptsNumber) {
            this.logger.info(`Scanning for voice rooms (attempt ${attempt}/${maxAttemptsNumber})`);
            
            const rooms = this.client.getRooms();
            if (!rooms?.length) {
                this.logger.info('No rooms available to scan');
                await new Promise(resolve => setTimeout(resolve, baseDelay * attempt));
                attempt++;
                continue;
            }

            let foundVoiceRoom = false;

            try {
                if (!this.voiceRoomId) {
                    this.logger.warn('No voice room ID configured.');
                    return null;
                }
                const room = this.client.getRoom(this.voiceRoomId);

                if (!room) {
                  this.logger.warn(`Voice room not found ${this.voiceRoomId}`);
                  return null;
                }

                // Add a delay before accessing room state
                setTimeout(async () => {
                    try {
                        const stateEvents = room.currentState.getStateEvents();
                        // this.logger.info(`All room state events for ${this.voiceRoomId}: ${JSON.stringify(stateEvents, null, 2)}`);

                        const widget = await this.getCallWidget(this.voiceRoomId);
                        if (widget && !this.activeCalls.has(this.voiceRoomId)) {
                            this.logger.info(`Auto-detected voice room: ${this.voiceRoomId}`, {
                                widgetUrl: widget.url,
                                detectionMethod: 'widget_scan'
                            });
                            await this.joinCall(this.voiceRoomId);
                            
                        }
                        
                    } catch (error) {
                        this.logger.error(`Error getting room state events: ${error.message}`);
                    }
                }, 1000); // 1-second delay

            } catch (error) {
                this.logger.error(`Error: ${error.message}`);
            }

            if (!foundVoiceRoom && attempt < maxAttemptsNumber) {
                const retryDelay = baseDelay * attempt;
                this.logger.info(`No voice rooms found. Retrying in ${retryDelay/1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }

            attempt++;
        }
        this.logger.warn(`No voice-enabled rooms found after ${maxAttemptsNumber} attempts`);
        return null;
    }

    async playSound(roomId, soundBuffer) {
        try {
            // Validate inputs
            if (!soundBuffer?.length) {
                throw new Error('Invalid or empty sound buffer');
            }

            const callData = this.activeCalls.get(roomId);
            if (!callData) {
                throw new Error('Not in active call');
            }

            // Convert buffer to audio stream
            const audioStream = await this.livekitClient.bufferToStream(soundBuffer);
            if (!audioStream) {
                throw new Error('Failed to convert buffer to audio stream');
            }

            // Play through LiveKit with timeout
            const result = await Promise.race([
                callData.connection.playAudio(audioStream),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Playback timed out')), 10000)
                )
            ]);

            return result ? {
                success: true,
                duration: result.duration,
                bytesProcessed: soundBuffer.length
            } : {
                success: false,
                error: 'Unknown error during playback',
                stack: 'No stack available'
            };
        } catch (error) {
            this.logger.error(`Play sound failed: ${error.message}`, {
                roomId,
                bufferLength: soundBuffer?.length || 0,
                inCall: this.activeCalls.has(roomId)
            });
            return {
                success: false,
                error: error.message,
                stack: error.stack
            };
        }
    }
}

export { VoiceManager };
