const { SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('prompt')
    .setDescription('Send a prompt to an AI agent on slopbox')
    .addStringOption(option =>
      option.setName('prompt')
        .setDescription('The instruction or task for the agent')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('agent')
        .setDescription('Which agent to execute')
        .setRequired(false)
        .addChoices(
          { name: 'Antigravity (agy)', value: 'agy' },
          { name: 'Claude Code', value: 'claude' },
          { name: 'Codex CLI', value: 'codex' }
        )
    )
    .addStringOption(option =>
      option.setName('project')
        .setDescription('Target project/repo in ~/src (e.g. mayfly, slop-landing, trough, nixfiles)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Summon the agent to join a voice channel')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Voice channel to join (defaults to your current voice channel)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Disconnect the agent from voice'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('View currently running agent jobs and server resources'),

  new SlashCommandBuilder()
    .setName('projects')
    .setDescription('List available projects in ~/src'),

  new SlashCommandBuilder()
    .setName('cancel')
    .setDescription('Cancel an active agent job')
    .addIntegerOption(option =>
      option.setName('job_id')
        .setDescription('The Job ID to cancel')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Help and guide for using Slopcord text and voice features')
];

module.exports = {
  commands
};
