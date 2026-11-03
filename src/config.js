const fs = require('fs');
const path = require('path');

const SECRETS_CONFIG = path.join(process.env.HOME || '/home/slop', '.secrets/discord/config.json');
const SECRETS_TOKEN = path.join(process.env.HOME || '/home/slop', '.secrets/discord/token');
const LOCAL_CONFIG = path.join(__dirname, '..', 'config.json');

function loadConfig() {
  let fileConfig = {};

  if (fs.existsSync(SECRETS_CONFIG)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(SECRETS_CONFIG, 'utf8'));
    } catch (err) {
      console.warn(`[Config] Warning: Failed to parse ${SECRETS_CONFIG}:`, err.message);
    }
  } else if (fs.existsSync(LOCAL_CONFIG)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(LOCAL_CONFIG, 'utf8'));
    } catch (err) {
      console.warn(`[Config] Warning: Failed to parse ${LOCAL_CONFIG}:`, err.message);
    }
  }

  let token = process.env.DISCORD_TOKEN || fileConfig.token;
  if (!token && fs.existsSync(SECRETS_TOKEN)) {
    try {
      token = fs.readFileSync(SECRETS_TOKEN, 'utf8').trim();
    } catch (err) {
      console.warn(`[Config] Warning: Failed to read token file:`, err.message);
    }
  }

  const homeDir = process.env.HOME || '/home/slop';
  const srcDir = path.join(homeDir, 'src');

  // Discover existing projects in ~/src
  const knownProjects = {};
  if (fs.existsSync(srcDir)) {
    try {
      const entries = fs.readdirSync(srcDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          knownProjects[entry.name.toLowerCase()] = path.join(srcDir, entry.name);
        }
      }
    } catch (err) {
      console.warn(`[Config] Warning: could not read ${srcDir}:`, err.message);
    }
  }

  // Common aliases for voice detection
  const projectAliases = {
    'landing': path.join(srcDir, 'slop-landing'),
    'site': path.join(srcDir, 'slop-landing'),
    'website': path.join(srcDir, 'slop-landing'),
    'guestbook': path.join(srcDir, 'slop-landing'),
    'fedi': path.join(srcDir, 'trough'),
    'fediverse': path.join(srcDir, 'trough'),
    'upload': path.join(srcDir, 'mayfly'),
    'pastebin': path.join(srcDir, 'mayfly'),
    'browser': path.join(srcDir, 'boybrowse'),
    'nix': path.join(srcDir, 'nixfiles'),
    'config': path.join(srcDir, 'nixfiles'),
    'system': path.join(srcDir, 'nixfiles'),
    'grindr': path.join(srcDir, 'open-grind-ios'),
    'amplifier': path.join(srcDir, 'xy-remote'),
    'ci': path.join(srcDir, 'hydra'),
    'slopcord': path.join(srcDir, 'slopcord'),
    'bot': path.join(srcDir, 'slopcord')
  };

  return {
    token: token || '',
    clientId: process.env.DISCORD_CLIENT_ID || fileConfig.clientId || '',
    guildId: process.env.DISCORD_GUILD_ID || fileConfig.guildId || '',
    defaultAgent: fileConfig.defaultAgent || process.env.DEFAULT_AGENT || 'agy',
    defaultProject: fileConfig.defaultProject || 'slop-landing',
    defaultVoiceChannel: fileConfig.defaultVoiceChannel || '',
    defaultTextChannel: fileConfig.defaultTextChannel || '',
    
    // Authorization: array of allowed Discord user IDs (or '*' to allow all guild members)
    allowedUsers: fileConfig.allowedUsers || (process.env.ALLOWED_USERS ? process.env.ALLOWED_USERS.split(',') : []),
    
    // Voice & Audio Configuration
    ttsVoice: fileConfig.ttsVoice || 'en-US-ChristopherNeural',
    ttsRate: fileConfig.ttsRate || '+0%',
    sttEngine: fileConfig.sttEngine || process.env.STT_ENGINE || 'groq', // 'groq', 'openai', 'local'
    groqApiKey: process.env.GROQ_API_KEY || fileConfig.groqApiKey || '',
    openaiApiKey: process.env.OPENAI_API_KEY || fileConfig.openaiApiKey || '',
    
    // Voice Triggers
    triggerWords: fileConfig.triggerWords || [
      'agent', 'slopcord', 'antigravity', 'claude', 'codex',
      'bot', 'assistant', 'computer', 'hey agent', 'slop'
    ],
    
    // Timeout in seconds for an agent run
    agentTimeoutSeconds: fileConfig.agentTimeoutSeconds || 600,
    
    // Paths & Projects
    homeDir,
    srcDir,
    knownProjects,
    projectAliases: Object.assign({}, knownProjects, projectAliases, fileConfig.customAliases || {})
  };
}

module.exports = {
  loadConfig
};
