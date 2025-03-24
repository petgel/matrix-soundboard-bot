import { LiveKitClient } from './livekit-client.js';
import { ElementCallJwtService } from './element-call-jwt-service.js';

class VoiceManager {
    constructor(client, logger) {
        this.client = client;
        this.logger = logger;
        this.livekitClient = new LiveKitClient();
        this.jwtService = new ElementCallJwtService();
        this.activeRooms = new Map();
        this.voiceRooms = new Map();
    }

    // Voice room management methods
    addVoiceRoom(roomId, details) {
        this.voiceRooms.set(roomId, details);
    }

    getVoiceRooms() {
        return this.voiceRooms;
    }

    hasActiveCall(roomId) {
        return this.activeRooms.has(roomId);
    }

    async detectVoiceRoom(room) {
        const callWidget = await this.getCallWidgetInRoom(room.roomId);
        if (callWidget) {
            this.addVoiceRoom(room.roomId, { detected: 'widget-based' });
        } else if (room?.name?.toLowerCase().includes('voice')) {
            this.addVoiceRoom(room.roomId, { detected: 'name-based' });
        }
    }

    setVoiceRoom(roomId, reason) {
        this.addVoiceRoom(roomId, { detected: reason });
    }

    async getCallWidgetInRoom(roomId) {
        const room = this.client.getRoom(roomId);
        if (!room) {
            this.logger.error(`Room not found: ${roomId}`);
            return null;
        }
        
        // Look for Element Call widgets in room state
        const widgetEvents = room.currentState.getStateEvents('m.widget');
        if (!widgetEvents || widgetEvents.length === 0) {
            this.logger.info(`No widget events found in room ${roomId}`);
            return null;
        }
        
        // Find Element Call widget by URL pattern
        for (const event of widgetEvents) {
            const content = event.getContent();
            if (content?.url?.includes('element.io/call/')) {
                this.logger.info(`Found Element Call widget: ${content.url}`);
                return {
                    widgetId: event.getStateKey(),
                    url: content.url,
                    name: content.name || 'Element Call',
                    data: content.data || {}
                };
            }
        }
        
        this.logger.info(`No Element Call widgets found in room ${roomId}`);
        return null;
    }

    async joinCall(requestRoomId) {
        try {
            const room = this.client.getRoom(requestRoomId);
            if (!room) {
                this.logger.error(`Room not found: ${requestRoomId}`);
                return false;
            }

            this.logger.info(`Attempting to join call in room: ${room.name} (${requestRoomId})`);
            
            // Get call widget - search both widget events and room state
            let callWidget = await this.getCallWidgetInRoom(requestRoomId);
            
            // Fallback to checking room state directly
            if (!callWidget) {
                this.logger.info(`Checking room state for Element Call widget...`);
                const widgetEvents = room.currentState.getStateEvents('m.widget');
                const elementCallEvent = widgetEvents.find(e => 
                    e.getContent()?.url?.includes('element.io/call/')
                );
                
                if (elementCallEvent) {
                    callWidget = {
                        widgetId: elementCallEvent.getStateKey(),
                        url: elementCallEvent.getContent().url,
                        name: elementCallEvent.getContent().name || 'Element Call'
                    };
                }
            }

            // Store origin room ID for sound playback reference

            if (!callWidget) {
                // Check if room is detected as voice room by name
                if (this.voiceRooms.has(requestRoomId)) {
                    this.logger.warn(`No Element Call widget found in voice room ${requestRoomId}, but proceeding anyway`);
                    
                    // Simulate basic connection
                    this.activeRooms.set(requestRoomId, {
                        originRoomId: requestRoomId,
                        joinedAt: new Date(),
                        roomName: room.name,
                        simulated: true
                    });
                    
                    this.logger.info(`Simulated joining call in room ${requestRoomId}`);
                    return true;
                }
                
                this.logger.error(`No Element Call widget found in room ${requestRoomId}`);
                return false;
            }

            // Extract LiveKit parameters from widget URL
            const livekitParams = this.livekitClient.extractLiveKitParams(callWidget.url);
            if (!livekitParams) {
                this.logger.error(`Could not extract LiveKit parameters from widget URL`);
                return false;
            }
            
            // Get a LiveKit token
            const botDisplayName = this.client.getUser(this.client.getUserId()).displayName || 'Soundboard Bot';
            const token = await this.jwtService.getLiveKitToken(
                this.client.getAccessToken(),
                requestRoomId,
                livekitParams.roomId
            );
            
            if (!token) {
                this.logger.error(`Could not get LiveKit token`);
                return false;
            }
            
            // Connect to the LiveKit room
            const livekitRoom = await this.livekitClient.connectToRoom(
                livekitParams.serverUrl,
                token,
                livekitParams.roomId
            );
            
            if (!livekitRoom) {
                this.logger.error(`Could not connect to LiveKit room`);
                return false;
            }
            
            // Mark this room as an active call
            this.activeRooms.set(requestRoomId, {
                callWidget,
                livekitRoom,
                livekitParams,
                originRoomId: requestRoomId,
                joinedAt: new Date(),
                roomName: room.name
            });
            
            this.logger.info(`Bot joined call in room ${requestRoomId} (${room.name})`);
            return true;
        } catch (error) {
            this.logger.error(`Error joining call: ${error.message}`);
            return false;
        }
    }

    async playSound(roomId, sound, mediaManager) {
        try {
            const roomDetails = this.activeRooms.get(roomId);
            if (!roomDetails) {
                this.logger.error(`No active call in room ${roomId}`);
                return { success: false };
            }

            if (roomDetails.simulated) {
                this.logger.info(`Simulated sound playback in ${roomId}: ${sound.name}`);
                return { success: true, simulated: true };
            }

            const soundPath = sound.path;
            const livekitRoomName = roomDetails.livekitParams.roomId;
            
            this.logger.info(`Attempting to play sound ${sound.name} in LiveKit room ${livekitRoomName}`);
            const result = await this.livekitClient.playSound(livekitRoomName, soundPath);
            
            return { success: result };
        } catch (error) {
            this.logger.error(`Error playing sound: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
}

export { VoiceManager };
