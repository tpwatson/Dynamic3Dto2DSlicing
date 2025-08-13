#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
let commitMessage = 'deploy'; // default message

// Check for custom commit message
const messageIndex = args.indexOf('-m');
if (messageIndex !== -1 && args[messageIndex + 1]) {
  commitMessage = args[messageIndex + 1];
}

console.log(`🚀 Deploying with commit message: "${commitMessage}"`);

try {
  
  // Add all files
  console.log('📁 Adding files to git...');
  execSync('git add .', { stdio: 'inherit' });
  
  // Commit with custom message
  console.log(`💾 Committing with message: "${commitMessage}"`);
  execSync(`git commit -m "${commitMessage}"`, { stdio: 'inherit' });
  
  // Push to remote
  console.log('🚀 Pushing to remote...');
  execSync('git push', { stdio: 'inherit' });
  
  // Start development server
  console.log('🔥 Starting development server...');
  execSync('npm run start', { stdio: 'inherit' });
  
} catch (error) {
  console.error('❌ Deployment failed:', error.message);
  process.exit(1);
} 