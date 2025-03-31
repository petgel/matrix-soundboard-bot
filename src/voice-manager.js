// src/voice-manager.js
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

        // First, check for MSC3401 call events (primary method for Element Call)
        const callEvents = room.currentState.getStateEvents('org.matrix.msc3401.call') || [];
        if (callEvents.length > 0) {
            this.logger.info(`Found MSC3401 call event in room ${roomId}`);
            const callEvent = callEvents[0];
            const content = callEvent.getContent();
            
            if (content) {
                // Even if there's no focus URL, we can still use this to detect a call
                return {
                    widgetId: callEvent.getStateKey(),
                    url: content.focus?.url || `https://call.element.io/#/?roomId=${encodeURIComponent(roomId)}`,
                    name: 'Element Call',
                    data: content,
                    isMSC3401: true
                };
            }
        }

        // Check for call member events
        const callMemberEvents = room.currentState.getStateEvents('org.matrix.msc3401.call.member') || [];
        if (callMemberEvents.length > 0) {
            this.logger.info(`Found MSC3401 call member events in room ${roomId}`);
            // A call member event indicates an active call
            return {
                widgetId: 'element-call',
                url: `https://call.element.io/#/?roomId=${encodeURIComponent(roomId)}`,
                name: 'Element Call',
                data: {},
                isMSC3401Member: true
            };
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
                const widgetName = content.name || '';

                // Check for various ways a call widget might appear
                if (widgetUrl && (
                    widgetUrl.includes('element-call') ||
                    widgetUrl.includes('call.element.io') ||
                    widgetUrl.includes('jitsi') ||
                    widgetName.toLowerCase().includes('call') ||
                    widgetName.toLowerCase().includes('voice')
                )) {
                    this.logger.info(`Found voice widget: ${widgetUrl}`);
                    return {
                        widgetId: event.getStateKey(),
                        url: widgetUrl,
                        name: content.name || 'Voice Call',
                        data: content.data || {}
                    };
                }
            } catch (error) {
                this.logger.error(`Error processing widget event: ${error.message}`);
            }
        }

        // As a last resort, check for room members to detect an active call
        try {
            // Check if the room is named or has properties suggesting it's a call room
            const roomName = room.name?.toLowerCase() || '';
            if (roomName.includes('call') || roomName.includes('voice') || roomName.includes('video')) {
                this.logger.info(`Room name suggests it's a call room: ${roomName}`);
                return {
                    widgetId: 'inferred-call',
                    url: `https://call.element.io/#/?roomId=${encodeURIComponent(roomId)}`,
                    name: 'Inferred Call',
                    data: {},
                    isInferred: true
                };
            }
        } catch (error) {
            this.logger.error(`Error checking room properties: ${error.message}`);
        }

        this.logger.info(`No Element Call widgets/events found in room ${roomId}`);
        return null;
    }

    async findUserActiveCall(userId) {
        try {
            if (!userId || !this.client) {
                this.logger.error("Invalid parameters for finding user call");
                return null;
            }
            
            this.logger.info(`Looking for active calls with user ${userId}`);
            
            const rooms = this.client.getRooms();
            for (const room of rooms) {
                try {
                    // Skip rooms where the user isn't a member
                    const userMember = room.getMember(userId);
                    if (!userMember) continue;
                    
                    // Check for call member events
                    const callMemberEvents = room.currentState.getStateEvents('org.matrix.msc3401.call.member') || [];
                    
                    // Look for call member events for this specific user
                    for (const memberEvent of callMemberEvents) {
                        const stateKey = memberEvent.getStateKey();
                        if (stateKey.startsWith(userId)) {
                            this.logger.info(`Found active call with user ${userId} in room ${room.roomId} (${room.name || 'unnamed'})`);
                            return {
                                roomId: room.roomId,
                                roomName: room.name || 'unnamed room',
                                callId: memberEvent.getContent().call_id || '',
                                widget: await this.getCallWidget(room.roomId)
                            };
                        }
                    }
                } catch (error) {
                    this.logger.error(`Error checking room ${room.roomId}: ${error.message}`);
                }
            }
            
            this.logger.info(`No active calls found for user ${userId}`);
            return null;
        } catch (error) {
            this.logger.error(`Error finding user call: ${error.message}`);
            return null;
        }
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
                this.logger.error(`No call widget or event found in ${roomId} after 3 attempts`);
                return false;
            }

            // Log what kind of call we found
            if (callWidget.isMSC3401) {
                this.logger.info(`Found MSC3401 call in room ${roomId}`);
            } else if (callWidget.isMSC3401Member) {
                this.logger.info(`Found MSC3401 call member in room ${roomId}`);
            } else if (callWidget.isInferred) {
                this.logger.info(`Inferred call in room ${roomId}`);
            } else {
                this.logger.info(`Found widget call in room ${roomId}`);
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
                livekitParams.roomName || roomId
            );

            if (!token) {
                this.logger.error('Failed to get LiveKit token');
                return false;
            }

            // Connect to LiveKit
            const connection = await this.elementCallDetector.connectToLiveKit(
                livekitParams.server || "https://call.element.io",
                token,
                livekitParams.roomName || roomId
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