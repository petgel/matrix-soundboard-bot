import { ElementCallDetector } from './element-call-detector.js';

export class VoiceManager {
    constructor(client, logger, voiceRoomId) {
        this.client = client;
        this.logger = logger;
        this.voiceRoomId = voiceRoomId;
        this.elementCallDetector = new ElementCallDetector(logger);
        this.activeCalls = new Map();
        this.homeserverUrl = process.env.MATRIX_HOMESERVER_URL;
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

        // Check for widget events
        const widgetEvents = room.currentState.getStateEvents('m.widget') || [];
        const modularWidgetEvents = room.currentState.getStateEvents('im.vector.modular.widgets') || [];
        const allWidgetEvents = [...widgetEvents, ...modularWidgetEvents];

        // Find Element Call widget
        for (const event of allWidgetEvents) {
            try {
                const content = event.getContent();
                const widgetUrl = content.url || content.data?.url;

                if (widgetUrl && widgetUrl.includes('element-call')) {
                    this.logger.info(`Found Element Call widget: ${widgetUrl}`);
                    return {
                        widgetId: event.getStateKey(),
                        url: widgetUrl,
                        name: content.name || 'Element Call',
                        data: content.data || {}
                    };
                }
            } catch (error) {
                this.logger.error(`Error processing widget event: ${error.message}`);
            }
        }

        // Check for MSC3401 call events
        const callEvents = room.currentState.getStateEvents('org.matrix.msc3401.call') || [];
        if (callEvents.length > 0) {
            this.logger.info(`Found MSC3401 call event in room ${roomId}`);
            const callEvent = callEvents[0];
            const content = callEvent.getContent();
            
            if (content && content.focus && content.focus.url) {
                return {
                    widgetId: callEvent.getStateKey(),
                    url: content.focus.url,
                    name: 'Element Call',
                    data: content
                };
            }
        }

        this.logger.info(`No Element Call widgets found in room ${roomId}`);
        return null;
    }

    async joinCall(roomId) {
        try {
            const room = this.client.getRoom(roomId);
            if (!room) {
                this.logger.error(`Room not found: ${roomId}`);
                return false;
            }

            if (this.activeCalls.has(roomId)) {
                this.logger.info(`Already in call in room ${roomId}`);
                return true;
            }

            // Find call widget with retries
            let callWidget = null;
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
            const livekitParams = this.elementCallDetector.parseWidgetUrl(callWidget.url);
            if (!livekitParams) {
                this.logger.error('Failed to extract LiveKit parameters');
                return false;
            }

            // Get JWT service URL
            const jwtServiceUrl = await this.elementCallDetector.getJwtServiceUrl(this.homeserverUrl);
            if (!jwtServiceUrl) {
                this.logger.error('Failed to discover JWT service URL');
                return false;
            }

            // Get JWT token for LiveKit
            const token = await this.elementCallDetector.getLiveKitToken(
                jwtServiceUrl,
                this.client.getAccessToken(),
                roomId,
                livekitParams.roomName
            );

            if (!token) {
                this.logger.error('Failed to get LiveKit token');
                return false;
            }

            // Connect to LiveKit
            const connection = await this.elementCallDetector.connectToLiveKit(
                livekitParams.server,
                token,
                livekitParams.roomName
            );

            if (!connection) {
                this.logger.error('Failed to connect to LiveKit');
                return false;
            }

            this.activeCalls.set(roomId, {
                connection,
                livekitParams,
                joinedAt: new Date(),
                widget: callWidget
            });

            this.logger.info(`Successfully joined call in room ${roomId}`);
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
        
        const rooms = this.client.getRooms();
        if (!rooms?.length) {
            this.logger.info('No rooms available to scan');
            return null;
        }

        // If voice room ID is configured, use that
        if (this.voiceRoomId) {
            const room = this.client.getRoom(this.voiceRoomId);
            if (room) {
                this.logger.info(`Using configured voice room: ${this.voiceRoomId}`);
                const joined = await this.joinCall(this.voiceRoomId);
                return joined ? this.voiceRoomId : null;
            } else {
                this.logger.warn(`Configured voice room ${this.voiceRoomId} not found`);
            }
        }

        // Otherwise scan for voice rooms
        for (const room of rooms) {
            try {
                const callWidget = await this.getCallWidget(room.roomId);
                if (callWidget) {
                    this.logger.info(`Auto-detected voice room: ${room.roomId}`);
                    const joined = await this.joinCall(room.roomId);
                    if (joined) return room.roomId;
                }
            } catch (error) {
                this.logger.error(`Error scanning room ${room.roomId}: ${error.message}`);
            }
        }

        this.logger.warn('No voice-enabled rooms found');
        return null;
    }

    async playSound(roomId, soundBuffer) {
        try {
            // Validate inputs
            if (!soundBuffer?.length) {
                throw new Error('Invalid or empty sound buffer');
            }

            // Check if we're in a call
            if (!this.activeCalls.has(roomId)) {
                // Try to join call
                const joined = await this.joinCall(roomId);
                if (!joined) {
                    throw new Error('Not in active call');
                }
            }

            const callData = this.activeCalls.get(roomId);
            
            // Play through Element Call detector
            const result = await this.elementCallDetector.playAudioBuffer(
                callData.livekitParams.roomName,
                soundBuffer
            );

            return result || {
                success: false,
                error: 'Failed to play sound'
            };
        } catch (error) {
            this.logger.error(`Play sound failed: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }

    leaveCall(roomId) {
        try {
            const callData = this.activeCalls.get(roomId);
            if (!callData) {
                return { success: false, error: 'Not in a call' };
            }

            if (callData.livekitParams && callData.livekitParams.roomName) {
                this.elementCallDetector.disconnect(callData.livekitParams.roomName);
            }

            this.activeCalls.delete(roomId);
            this.logger.info(`Left call in room ${roomId}`);
            return { success: true };
        } catch (error) {
            this.logger.error(`Error leaving call: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
}
