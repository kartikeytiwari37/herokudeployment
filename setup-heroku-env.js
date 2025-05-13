#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to prompt for input with a default value
function prompt(question, defaultValue) {
  return new Promise((resolve) => {
    rl.question(`${question} (${defaultValue}): `, (answer) => {
      resolve(answer || defaultValue);
    });
  });
}

async function setupHerokuEnv() {
  console.log('Setting up Heroku environment variables from .env.heroku template...');
  
  // Check if .env.heroku exists
  if (!fs.existsSync('.env.heroku')) {
    console.error('Error: .env.heroku file not found!');
    process.exit(1);
  }
  
  // Read the .env.heroku file
  const envFile = fs.readFileSync('.env.heroku', 'utf8');
  const envLines = envFile.split('\n');
  
  // Ask for Heroku app name
  const herokuAppName = await prompt('Enter your Heroku app name', 'your-app-name');
  
  // Process each line
  const configVars = [];
  
  for (const line of envLines) {
    // Skip comments and empty lines
    if (line.trim().startsWith('#') || line.trim() === '') {
      continue;
    }
    
    // Parse key-value pairs
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.substring(1, value.length - 1);
      }
      
      // Skip template values
      if (value.includes('your_') || value === 'your-app-name.herokuapp.com') {
        // For PUBLIC_URL and BASE_URL, use the Heroku app URL
        if (key === 'PUBLIC_URL' || key === 'BASE_URL') {
          value = `https://${herokuAppName}.herokuapp.com`;
        } else {
          // Ask for actual value
          value = await prompt(`Enter value for ${key}`, value);
        }
      }
      
      configVars.push({ key, value });
    }
  }
  
  // Confirm before setting variables
  console.log('\nThe following environment variables will be set in Heroku:');
  for (const { key, value } of configVars) {
    console.log(`${key}=${value}`);
  }
  
  const confirm = await prompt('\nDo you want to set these variables in Heroku? (yes/no)', 'yes');
  
  if (confirm.toLowerCase() !== 'yes') {
    console.log('Operation cancelled.');
    rl.close();
    return;
  }
  
  // Set variables in Heroku
  console.log('\nSetting environment variables in Heroku...');
  
  try {
    // Check if heroku CLI is installed
    execSync('heroku --version', { stdio: 'ignore' });
    
    // Check if user is logged in
    execSync('heroku auth:whoami', { stdio: 'ignore' });
    
    // Set each variable
    for (const { key, value } of configVars) {
      console.log(`Setting ${key}...`);
      execSync(`heroku config:set ${key}="${value}" --app ${herokuAppName}`);
    }
    
    console.log('\nEnvironment variables successfully set in Heroku!');
  } catch (error) {
    console.error('Error: Failed to set Heroku environment variables.');
    console.error('Make sure you have the Heroku CLI installed and you are logged in.');
    console.error('Run "heroku login" to authenticate.');
    console.error(error.message);
  }
  
  rl.close();
}

setupHerokuEnv();
