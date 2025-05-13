# Voice Backend

A simplified backend-only voice platform that integrates Twilio for telephony and OpenAI for real-time AI conversations.

## Features

- Make outbound calls via a simple API
- Real-time voice conversations with OpenAI's GPT-4o
- Automatic transcription of conversations
- Transcript logging to JSON files

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Twilio account with a phone number
- OpenAI API key with access to GPT-4o Realtime

## Installation

1. Clone the repository
2. Install dependencies:

```bash
cd voice-backend
npm install
```

3. Configure environment variables:

Copy the `.env` file and update it with your credentials:

```bash
# Server configuration
PORT=3000
PUBLIC_URL=https://your-public-url.com  # Must be accessible from the internet for Twilio

# Twilio credentials
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token

# OpenAI configuration
OPENAI_API_KEY=your_openai_api_key
```

## Usage

### Starting the server

```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start
```

### Getting available phone numbers

Send a GET request to the `/api/numbers` endpoint:

```bash
curl http://localhost:3000/api/numbers
```

Response:

```json
[
  {
    "sid": "PN123456789abcdef",
    "phoneNumber": "+1234567890",
    "friendlyName": "My Twilio Number"
  }
]
```

### Making a call

Send a POST request to the `/api/call` endpoint:

```bash
curl -X POST http://localhost:3000/api/call \
  -H "Content-Type: application/json" \
  -d '{"number": "+1234567890", "fromNumber": "+0987654321"}'
```

The `fromNumber` parameter is optional. If not provided, the system will use the first available Twilio phone number.

### Getting a transcript

After a call has ended, you can retrieve the transcript using the call SID:

```bash
curl http://localhost:3000/api/transcript/CA123456789abcdef
```

You can also get the transcript in plain text format:

```bash
curl http://localhost:3000/api/transcript/CA123456789abcdef?format=text
```

Response:

```json
{
  "success": true,
  "callSid": "CA123456789abcdef",
  "message": "Call initiated to +1234567890"
}
```

### Ending a call

Send a POST request to the `/api/end-call` endpoint:

```bash
curl -X POST http://localhost:3000/api/end-call \
  -H "Content-Type: application/json" \
  -d '{"callSid": "CA123456789abcdef"}'
```

Response:

```json
{
  "success": true,
  "message": "Call ended successfully"
}
```

## How It Works

1. When a call is initiated via the API, Twilio makes a request to the `/twiml` endpoint to get instructions.
2. The TwiML response tells Twilio to connect to the WebSocket server.
3. Twilio establishes a WebSocket connection and streams audio to the server.
4. The server forwards the audio to OpenAI's real-time API.
5. OpenAI processes the audio, generates responses, and streams them back.
6. The server forwards the audio responses back to Twilio.
7. The conversation is transcribed and logged to a JSON file when the call ends.

## Transcript Logs

Transcripts are saved in the `logs` directory with the following format:

```
{callSid}_{phoneNumber}_{timestamp}.json
```

Each transcript file contains:
- Call SID
- Phone number
- Timestamp
- Complete transcript with user and assistant messages

## Public URL Configuration

For Twilio to connect to your WebSocket server, it needs a public URL. In development, you can use a service like ngrok:

```bash
ngrok http 3000
```

Then update your `.env` file with the ngrok URL:

```
PUBLIC_URL=https://your-ngrok-url.ngrok.io
```

## License

MIT
