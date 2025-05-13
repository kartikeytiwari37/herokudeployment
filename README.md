# Voice Backend Application

A Node.js/TypeScript backend application for voice interactions using Twilio.

## Deployment to Heroku

### Prerequisites

- [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli) installed
- [Git](https://git-scm.com/) installed
- Heroku account

### Deployment Steps

1. **Login to Heroku**

   ```bash
   heroku login
   ```

2. **Create a new Heroku app**

   ```bash
   heroku create your-app-name
   ```

   Replace `your-app-name` with your desired application name.

3. **Add Heroku remote**

   ```bash
   heroku git:remote -a your-app-name
   ```

4. **Set up environment variables**

   Use the provided script to set up environment variables from the `.env.heroku` template:

   ```bash
   # Make the script executable
   chmod +x setup-heroku-env.js
   
   # Run the script
   node setup-heroku-env.js
   ```

   The script will prompt you for necessary values and set them in your Heroku app.

5. **Deploy to Heroku**

   ```bash
   git push heroku main
   ```

   Or if you're on a different branch:

   ```bash
   git push heroku your-branch:main
   ```

6. **Scale the application**

   ```bash
   heroku ps:scale web=1
   ```

7. **Open the application**

   ```bash
   heroku open
   ```

## Manual Environment Variable Setup

If you prefer to set up environment variables manually, you can do so through the Heroku Dashboard or using the Heroku CLI:

```bash
heroku config:set KEY=VALUE
```

Make sure to set all the required environment variables listed in the `.env.heroku` file.

## Important Environment Variables

- `PORT`: Automatically set by Heroku
- `PUBLIC_URL`: Your Heroku app URL (e.g., https://your-app-name.herokuapp.com)
- `BASE_URL`: Same as PUBLIC_URL
- `MONGODB_URI`: Your MongoDB connection string
- `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`: Your Twilio credentials
- `AI_PROVIDER`: Set to "openai" or "azure"
- API keys for OpenAI or Azure OpenAI depending on your AI provider

## Build Process

The application uses the following build process on Heroku:

1. The `heroku-prebuild` script runs first, using `npm install --no-package-lock` to install dependencies without requiring a package-lock.json file
2. Heroku installs dependencies from package.json
3. The `heroku-postbuild` script runs automatically, which executes `npm run build`
4. The build script compiles TypeScript code and copies XML files to the dist directory
5. Heroku starts the application using the `start` script

### Important Notes

- TypeScript and other build dependencies are included in the main dependencies (not devDependencies) to ensure they're available during the Heroku build process
- The `heroku-prebuild` script is used to bypass the need for a synchronized package-lock.json file

## Troubleshooting

- **View logs**: `heroku logs --tail`
- **Restart the application**: `heroku restart`
- **Check build packs**: `heroku buildpacks`
- **SSH into the dyno**: `heroku ps:exec`

## Local Development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file based on `.env.example`

3. Run the development server:

   ```bash
   npm run dev
   ```

4. Build for production:

   ```bash
   npm run build
   ```

5. Start the production server:

   ```bash
   npm start
   ```
