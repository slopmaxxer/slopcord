#!/usr/bin/env node
const { Client, GatewayIntentBits, REST, Routes, ActivityType, EmbedBuilder, ChannelType } = require('discord.js');
const os = require('os');
const { loadConfig } = require('./config');
const { AgentRunner } = require('./agentRunner');
const { DiscordUI } = require('./discordUI');
const { VoiceManager } = require('./voice/voiceManager');
const { commands } = require('./commands');

async function main() {
  const config = loadConfig();

  if (!config.token) {
    console.error('[Slopcord] ERROR: No Discord Bot token found!');
    console.error('Please configure your token in ~/.secrets/discord/token, config.json, or DISCORD_TOKEN environment variable.');
    process.exit(1);
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers
    ]
  });

  const agentRunner = new AgentRunner(config);
  const ui = new DiscordUI(agentRunner);
  const voiceManager = new VoiceManager(config, agentRunner, ui);

  function isAuthorized(userId) {
    if (!config.allowedUsers || config.allowedUsers.length === 0) return true;
    if (config.allowedUsers.includes('*') || config.allowedUsers.includes(userId)) return true;
    return false;
  }

  // Register Slash Commands
  async function registerSlashCommands() {
    try {
      const rest = new REST({ version: '10' }).setToken(config.token);
      const clientId = config.clientId || client.user.id;
      const commandsJson = commands.map(c => c.toJSON());

      if (config.guildId) {
        console.log(`[Slopcord] Registering slash commands to Guild ${config.guildId}...`);
        try {
          await rest.put(Routes.applicationGuildCommands(clientId, config.guildId), { body: commandsJson });
          console.log('[Slopcord] Guild slash commands registered successfully.');
          return;
        } catch (guildErr) {
          if (guildErr.code === 50001) {
            console.warn(`[Slopcord] Note: Bot has not joined Guild ${config.guildId} yet. Invite the bot to the server using the OAuth2 link, and commands will register automatically.`);
          } else {
            console.error('[Slopcord] Failed to register guild slash commands:', guildErr.message);
          }
        }
      }

      console.log('[Slopcord] Registering slash commands globally...');
      await rest.put(Routes.applicationCommands(clientId), { body: commandsJson });
      console.log('[Slopcord] Global slash commands registered successfully.');
    } catch (err) {
      console.error('[Slopcord] Failed to register slash commands:', err.message);
    }
  }

  client.once('clientReady', async () => {
    console.log(`[Slopcord] Logged in as ${client.user.tag} (ID: ${client.user.id})`);
    client.user.setActivity('slopbox servers | /help', { type: ActivityType.Listening });
    await registerSlashCommands();
  });

  client.on('guildCreate', async (guild) => {
    console.log(`[Slopcord] Joined new guild: ${guild.name} (${guild.id}). Registering slash commands...`);
    await registerSlashCommands();
  });

  // Interaction Handler
  client.on('interactionCreate', async (interaction) => {
    // Button Interactions
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('cancel_task_')) {
        const jobIdStr = interaction.customId.replace('cancel_task_', '');
        const jobId = parseInt(jobIdStr, 10);
        if (jobId && agentRunner.cancelJob(jobId, `Cancelled via Discord button by ${interaction.user.tag}`)) {
          await interaction.reply({ content: `🛑 Task #${jobId} has been cancelled.`, ephemeral: true });
        } else {
          await interaction.reply({ content: `Task #${jobIdStr} is no longer running.`, ephemeral: true });
        }
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const { commandName, user } = interaction;

    if (!isAuthorized(user.id)) {
      return interaction.reply({
        content: `⛔ You are not authorized to control agents on this server.`,
        ephemeral: true
      });
    }

    try {
      if (commandName === 'prompt') {
        const prompt = interaction.options.getString('prompt');
        const agent = interaction.options.getString('agent') || config.defaultAgent;
        const project = interaction.options.getString('project') || config.defaultProject;

        await interaction.deferReply();

        const channel = interaction.channel;
        const thread = await ui.createTaskThread(channel, {
          user,
          source: 'text',
          agent,
          project,
          prompt
        });

        const job = agentRunner.startJob({
          prompt,
          agent,
          project,
          user: user.tag
        });

        if (thread) {
          ui.bindJobToThread(job, thread);
          await interaction.editReply({
            content: `🚀 Started **${agent}** task in project \`${job.project}\`!\nFollow live updates in thread: <#${thread.id}>`
          });
        } else {
          await interaction.editReply({
            content: `🚀 Started **${agent}** task #${job.id} in project \`${job.project}\`.`
          });
        }
      } else if (commandName === 'join') {
        const requestedChannel = interaction.options.getChannel('channel');
        let voiceChannel = requestedChannel;

        if (!voiceChannel) {
          const member = interaction.member;
          voiceChannel = member?.voice?.channel;
        }

        if (!voiceChannel || (voiceChannel.type !== ChannelType.GuildVoice && voiceChannel.type !== ChannelType.GuildStageVoice)) {
          return interaction.reply({
            content: '⚠️ Please join a voice channel first, or specify a valid voice channel.',
            ephemeral: true
          });
        }

        await interaction.deferReply();
        try {
          await voiceManager.join(voiceChannel, interaction.channel);
          await interaction.editReply(`🎙️ Connected to **${voiceChannel.name}**! Speak naturally or address me with "agent", "antigravity", or "claude" to build features.`);
        } catch (err) {
          await interaction.editReply(`❌ Failed to join voice channel: ${err.message}`);
        }
      } else if (commandName === 'leave') {
        voiceManager.leave();
        await interaction.reply('👋 Disconnected from voice channel.');
      } else if (commandName === 'status') {
        const activeJobs = agentRunner.getActiveJobs();
        const memFree = Math.round(os.freemem() / 1024 / 1024 / 1024);
        const memTotal = Math.round(os.totalmem() / 1024 / 1024 / 1024);
        const load = os.loadavg().map(n => n.toFixed(2)).join(', ');

        const embed = new EmbedBuilder()
          .setTitle('🖥️ Slopbox Agent Server Status')
          .setColor(0x5865F2)
          .addFields(
            { name: 'Active Agent Tasks', value: activeJobs.length > 0 ? activeJobs.map(j => `#${j.id} [${j.agent}] ${j.project} (${j.runningForSeconds}s): "${j.prompt}"`).join('\n') : 'None running', inline: false },
            { name: 'Host Memory', value: `${memTotal - memFree} GB used / ${memTotal} GB total`, inline: true },
            { name: 'CPU Load (1m, 5m, 15m)', value: load, inline: true },
            { name: 'Voice Connected', value: voiceManager.connection ? `Yes (${voiceManager.currentVoiceChannel?.name})` : 'No', inline: true }
          )
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
      } else if (commandName === 'projects') {
        const projectsList = Object.keys(config.knownProjects).sort().map(p => `• \`${p}\``).join('\n');
        const embed = new EmbedBuilder()
          .setTitle('📁 Available Projects in ~/src')
          .setColor(0x5865F2)
          .setDescription(projectsList || 'No projects discovered.')
          .setFooter({ text: 'Specify any of these projects in /prompt or in voice.' });

        await interaction.reply({ embeds: [embed] });
      } else if (commandName === 'cancel') {
        const jobId = interaction.options.getInteger('job_id');
        const success = agentRunner.cancelJob(jobId, `Cancelled via /cancel by ${user.tag}`);
        if (success) {
          await interaction.reply(`🛑 Successfully cancelled Task #${jobId}.`);
        } else {
          await interaction.reply({ content: `⚠️ Job #${jobId} is not running or could not be found.`, ephemeral: true });
        }
      } else if (commandName === 'help') {
        const embed = new EmbedBuilder()
          .setTitle('🤖 Slopcord Agent Guide')
          .setColor(0x5865F2)
          .setDescription('Slopcord connects Discord to AI coding agents running directly on the `slopbox` NixOS server.')
          .addFields(
            {
              name: '💬 Text Control',
              value: '• `/prompt <instruction> [agent] [project]` - Run a task\n• Mention `@Slopcord <prompt>` in any text channel\n• **Thread follow-ups:** Simply reply inside the generated task thread to continue iterating with the agent!'
            },
            {
              name: '🎙️ Voice Call Control',
              value: '• `/join` - Bot joins your current Discord voice call\n• Talk directly in the call. Say **"Hey agent"**, **"Antigravity"**, or **"Claude"** followed by what you want to build\n• Example: *"Hey Antigravity, add a health check endpoint to mayfly"*\n• The bot verbally confirms, starts the build, and speaks back in the call when complete!'
            },
            {
              name: '⚙️ Utilities',
              value: '• `/projects` - List all projects in `~/src`\n• `/status` - Check active tasks, CPU & RAM\n• `/cancel <job_id>` - Abort a running task\n• `/leave` - Disconnect from voice'
            }
          );

        await interaction.reply({ embeds: [embed] });
      }
    } catch (err) {
      console.error('[Slopcord] Error handling command:', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: `An error occurred: ${err.message}`, ephemeral: true });
      } else {
        await interaction.followUp({ content: `An error occurred: ${err.message}`, ephemeral: true });
      }
    }
  });

  // Message Handler (Thread continuations & text mentions)
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // 1. Thread Replies for interactive iteration
    if (message.channel.isThread()) {
      const session = ui.getSession(message.channel.id);
      if (session) {
        if (!isAuthorized(message.author.id)) {
          return message.reply('⛔ You are not authorized to run agent commands.');
        }

        const prompt = message.content.trim();
        if (!prompt) return;

        const replyMsg = await message.reply(`🔄 Continuing **${session.agent}** session on \`${session.project}\`...`);

        const job = agentRunner.startJob({
          prompt,
          agent: session.agent,
          project: session.project,
          user: message.author.tag,
          conversationId: session.conversationId
        });

        ui.bindJobToThread(job, message.channel);
        return;
      }
    }

    // 2. Mentions in standard text channels
    if (message.mentions.has(client.user.id) && !message.mentions.everyone) {
      if (!isAuthorized(message.author.id)) {
        return message.reply('⛔ You are not authorized to run agent commands.');
      }

      // Strip mention tag
      const rawPrompt = message.content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
      if (!rawPrompt) {
        return message.reply('How can I help? Send `/help` or tell me what to build!');
      }

      // Parse intent for project or agent keywords
      const intent = voiceManager.intentParser.parse(rawPrompt, message.author.id);
      const agent = intent.agent || config.defaultAgent;
      const project = intent.project || config.defaultProject;
      const prompt = intent.prompt || rawPrompt;

      const thread = await ui.createTaskThread(message.channel, {
        user: message.author,
        source: 'text',
        agent,
        project,
        prompt
      });

      const job = agentRunner.startJob({
        prompt,
        agent,
        project,
        user: message.author.tag
      });

      if (thread) {
        ui.bindJobToThread(job, thread);
        await message.reply(`🚀 Started **${agent}** task in thread: <#${thread.id}>`);
      }
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('[Slopcord] Shutting down...');
    voiceManager.leave();
    for (const [id] of agentRunner.activeJobs) {
      agentRunner.cancelJob(id, 'Server shutting down');
    }
    client.destroy();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await client.login(config.token);
}

main().catch(err => {
  console.error('[Slopcord] Fatal startup error:', err);
  process.exit(1);
});
