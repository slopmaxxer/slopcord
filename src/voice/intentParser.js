class IntentParser {
  constructor(config = {}) {
    this.config = config;
    this.triggerWords = (config.triggerWords || [
      'agent', 'slopcord', 'antigravity', 'claude', 'codex',
      'bot', 'assistant', 'computer', 'hey agent', 'slop'
    ]).map(w => w.toLowerCase());

    this.projectAliases = config.projectAliases || {};
    this.lastActiveProjects = new Map(); // userId -> last project mentioned
    this.lastActiveTimes = new Map();    // userId -> timestamp
  }

  isAuthorized(userId) {
    if (!this.config.allowedUsers || this.config.allowedUsers.length === 0) {
      return true;
    }
    if (this.config.allowedUsers.includes('*') || this.config.allowedUsers.includes(userId)) {
      return true;
    }
    return false;
  }

  parse(rawText, userId = 'voice-user') {
    if (!rawText || typeof rawText !== 'string') {
      return { triggered: false };
    }

    const text = rawText.trim();
    const lower = text.toLowerCase().replace(/[,.?!]/g, '');

    // Check if within active conversation window (15 seconds after previous prompt)
    const lastTime = this.lastActiveTimes.get(userId) || 0;
    const isWithinFollowupWindow = (Date.now() - lastTime) < 15000;

    let triggered = false;
    let triggerMatch = '';

    for (const tw of this.triggerWords) {
      const regex = new RegExp(`\\b${tw}\\b`, 'i');
      if (regex.test(text)) {
        triggered = true;
        triggerMatch = tw;
        break;
      }
    }

    if (!triggered && isWithinFollowupWindow) {
      // Conversational follow-up: user continues talking to the bot
      triggered = true;
    }

    if (!triggered) {
      return { triggered: false, rawText: text };
    }

    // Determine Agent
    let agent = this.config.defaultAgent || 'agy';
    if (/\b(claude)\b/i.test(text)) {
      agent = 'claude';
    } else if (/\b(codex)\b/i.test(text)) {
      agent = 'codex';
    } else if (/\b(antigravity|agy)\b/i.test(text)) {
      agent = 'agy';
    }

    // Determine Project
    let project = null;
    let projectPath = null;

    // Scan for project aliases
    const words = lower.split(/\s+/);
    for (const word of words) {
      if (this.projectAliases[word]) {
        project = word;
        projectPath = this.projectAliases[word];
        break;
      }
    }

    // If no project explicitly named, check previous active project or default
    if (!project) {
      if (isWithinFollowupWindow && this.lastActiveProjects.has(userId)) {
        project = this.lastActiveProjects.get(userId);
        projectPath = this.projectAliases[project] || (this.config.knownProjects && this.config.knownProjects[project]) || null;
      } else {
        project = this.config.defaultProject;
        projectPath = this.projectAliases[project] || (this.config.knownProjects && this.config.knownProjects[project]) || null;
      }
    }

    // Update active user state
    this.lastActiveProjects.set(userId, project);
    this.lastActiveTimes.set(userId, Date.now());

    // Extract cleaned prompt
    let cleanedPrompt = text;
    if (triggerMatch) {
      const triggerRegex = new RegExp(`^.*?\\b${triggerMatch}\\b[:\\s,]*`, 'i');
      cleanedPrompt = text.replace(triggerRegex, '').trim();
    }

    // Remove filler prefixes
    cleanedPrompt = cleanedPrompt.replace(/^(can you|could you|please|i want you to|go ahead and|build|create|fix)\s+/i, (match) => {
      // Keep build/create/fix if it is the core action
      if (/^(build|create|fix)$/i.test(match.trim())) return match;
      return '';
    }).trim();

    if (!cleanedPrompt) {
      cleanedPrompt = text;
    }

    return {
      triggered: true,
      agent,
      project,
      projectPath,
      prompt: cleanedPrompt,
      rawText: text
    };
  }
}

module.exports = {
  IntentParser
};
