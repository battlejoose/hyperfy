# 🎤 Voice Chat Setup Guide

Hyperfy includes built-in voice chat powered by [LiveKit](https://livekit.io/). This guide will help you set up voice chat for your world.

## Overview

Hyperfy's voice chat system provides:
- **Spatial Audio** - 3D positional audio based on player positions (sounds come from where players are located)
- **Global Audio** - Everyone can hear everyone regardless of position
- **Mute/Unmute** - Individual player muting controls
- **Screen Sharing** - Share your screen with other players
- **Speaking Indicators** - Visual indicators when players are speaking

## Prerequisites

You need a LiveKit server instance. You have two options:

### Option 1: LiveKit Cloud (Recommended for Quick Start)

1. Sign up for a free account at [LiveKit Cloud](https://cloud.livekit.io/)
2. Create a new project
3. Get your credentials from the project dashboard:
   - **WebSocket URL** (e.g., `wss://your-project.livekit.cloud`)
   - **API Key**
   - **API Secret**

### Option 2: Self-Hosted LiveKit Server

1. Follow the [LiveKit self-hosting guide](https://docs.livekit.io/deployment/)
2. Set up your LiveKit server
3. Note your WebSocket URL, API Key, and API Secret

## Configuration

Add the following environment variables to your `.env` file (or set them in your deployment environment):

```bash
# LiveKit Configuration
LIVEKIT_WS_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-api-key-here
LIVEKIT_API_SECRET=your-api-secret-here
```

### Environment Variables Explained

- **`LIVEKIT_WS_URL`** - The WebSocket URL of your LiveKit server (must start with `ws://` or `wss://`)
- **`LIVEKIT_API_KEY`** - Your LiveKit API key for authentication
- **`LIVEKIT_API_SECRET`** - Your LiveKit API secret for token generation

## How It Works

### Server-Side (`ServerLiveKit.js`)

When a player connects:
1. The server generates a unique access token for that player
2. The token includes permissions to join the room, publish microphone audio, and subscribe to other players' audio
3. The token and connection details are sent to the client

### Client-Side (`ClientLiveKit.js`)

When the client receives LiveKit configuration:
1. Creates a LiveKit Room instance connected to your audio context
2. Connects to the LiveKit server using the provided token
3. Sets up spatial audio processing (HRTF panning) for 3D positional audio
4. Manages microphone input/output and player voice tracks

### Voice Modes

Players can have three voice modes:

- **`disabled`** - Voice chat is disabled for this player
- **`spatial`** - 3D positional audio (default) - players hear others based on their position in the world
- **`global`** - Everyone can hear everyone regardless of position

The default voice mode is set in world settings (`world.settings.voice`).

## UI Controls

Once LiveKit is configured, players will see:

- **Microphone Button** in the sidebar (appears when LiveKit is available)
  - Click to toggle microphone on/off
  - Shows mic icon when active, mic-off icon when muted
  - Button is disabled/grayed out when voice chat is disabled or muted

## Testing

1. Start your server with the LiveKit environment variables set
2. Connect multiple clients/browsers
3. Click the microphone button in the sidebar to enable your mic
4. Speak and verify that other players can hear you
5. Move around in the world to test spatial audio (sounds should come from where players are located)

## Troubleshooting

### Voice chat not appearing

- Check that all three environment variables are set correctly
- Verify your LiveKit server is running and accessible
- Check server logs for any LiveKit connection errors

### Can't hear other players

- Ensure microphone permissions are granted in the browser
- Check that players have enabled their microphone (mic icon should be active)
- Verify the voice mode is not set to `disabled`

### Spatial audio not working

- Ensure players have `spatial` voice mode enabled (not `global` or `disabled`)
- Check that players are moving around in the 3D world (spatial audio only works when players are at different positions)

## Advanced Configuration

### Custom Voice Levels

You can programmatically control voice levels using the LiveKit system:

```javascript
// In your app code
world.livekit.addModifier(playerId, 'spatial')  // Enable spatial audio
world.livekit.addModifier(playerId, 'global')   // Switch to global audio
world.livekit.removeModifier(modifier)          // Remove modifier
```

### Muting Players

```javascript
world.livekit.setMuted(playerId, true)   // Mute a player
world.livekit.setMuted(playerId, false)  // Unmute a player
```

## Security Notes

- Keep your `LIVEKIT_API_SECRET` secure and never commit it to version control
- Use environment variables or secure secret management for production deployments
- The server generates time-limited access tokens for each player connection

## Additional Resources

- [LiveKit Documentation](https://docs.livekit.io/)
- [LiveKit Cloud](https://cloud.livekit.io/)
- [LiveKit Self-Hosting Guide](https://docs.livekit.io/deployment/)

