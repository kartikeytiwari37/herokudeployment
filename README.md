# Twilio Real-time Server with TypeScript

A Node.js TypeScript application that integrates Twilio for voice calls, OpenAI for real-time AI conversations, MongoDB for data storage, and AWS S3 for file storage.

## Features

- Real-time voice calls with AI-powered interviewing
- WebSocket connections for real-time communication
- MongoDB integration for data storage
- AWS S3 integration for file storage
- TypeScript for type safety

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- MongoDB database
- AWS S3 bucket
- OpenAI API key
- Twilio account (for voice calls)

## Local Development

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file based on `.env.example`
4. Run the development server:
   ```
   npm run dev
   ```

## Deployment to Heroku

### Prerequisites

1. [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli) installed
2. Heroku account
3. Git installed

### Steps to Deploy

1. Login to Heroku:
   ```
   heroku login
   ```

2. Create a new Heroku app:
   ```
   heroku create your-app-name
   ```

3. Add the Heroku remote:
   ```
   heroku git:remote -a your-app-name
   ```

4. Set up environment variables in Heroku:

   **Option 1: Using the provided script**
   
   We've included a helper script to set up all environment variables from your local `.env` file:
   
   ```
   node setup-heroku-env.js your-app-name
   ```
   
   **Option 2: Manually setting variables**
   
   ```
   heroku config:set OPENAI_API_KEY=your_openai_api_key
   heroku config:set MONGODB_URI=your_mongodb_uri
   heroku config:set AWS_ACCESS_KEY_ID=your_aws_access_key_id
   heroku config:set AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
   heroku config:set AWS_REGION=your_aws_region
   heroku config:set AWS_S3_BUCKET=your_aws_s3_bucket
   ```
   
   See `.env.heroku` for a complete list of environment variables to set.

5. Push to Heroku:
   ```
   git push heroku main
   ```

6. Open the app:
   ```
   heroku open
   ```

### Important Notes for Heroku Deployment

- The application uses WebSockets, which are supported on Heroku.
- Make sure to set all required environment variables in Heroku Config Vars.
- The `PUBLIC_URL` will be automatically set to your Heroku app URL.
- The application uses the `PORT` environment variable, which Heroku sets automatically.

## Environment Variables

See `.env.example` and `.env.heroku` for a list of required environment variables.

## License

ISC
