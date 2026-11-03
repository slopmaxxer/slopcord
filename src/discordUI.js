const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

class DiscordUI {
  constructor(agentRunner) {
    this.agentRunner = agentRunner;
    this.threadSessions = new Map(); // threadId -> { agent, project, conversationId, lastJobId }
  }

  async createTaskThread(channel, taskInfo) {
    const title = `🤖 [${taskInfo.agent}] ${taskInfo.prompt.slice(0, 75).replace(/[\n\r]/g, ' ')}`;
    
    let thread;
    try {
      if (channel.threads) {
        thread = await channel.threads.create({
          name: title,
          autoArchiveDuration: 60,
          reason: `Agent task for ${taskInfo.user.tag || taskInfo.user.username}`
        });
      } else {
        return null;
      }
    } catch (err) {
      console.error('[DiscordUI] Failed to create thread:', err);
      return null;
    }

    const embed = new EmbedBuilder()
      .setTitle(`🚀 Agent Task Started`)
      .setColor(0x5865F2)
      .addFields(
        { name: 'Initiator', value: `<@${taskInfo.user.id}> (${taskInfo.source === 'voice' ? '🎙️ Voice' : '💬 Text'})`, inline: true },
        { name: 'Agent', value: `\`${taskInfo.agent}\``, inline: true },
        { name: 'Project', value: `\`${taskInfo.project}\``, inline: true },
        { name: 'Prompt', value: taskInfo.prompt.length > 1024 ? taskInfo.prompt.slice(0, 1021) + '...' : taskInfo.prompt }
      )
      .setTimestamp();

    if (taskInfo.source === 'voice' && taskInfo.rawText) {
      embed.setFooter({ text: `Transcribed from voice: "${taskInfo.rawText.slice(0, 100)}"` });
    }

    const cancelBtn = new ButtonBuilder()
      .setCustomId(`cancel_task_${taskInfo.jobId || 'pending'}`)
      .setLabel('Stop Task')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🛑');

    const row = new ActionRowBuilder().addComponents(cancelBtn);

    const initialMsg = await thread.send({ embeds: [embed], components: [row] });
    thread._initialMsg = initialMsg;

    return thread;
  }

  bindJobToThread(job, thread) {
    if (!thread) return;

    this.threadSessions.set(thread.id, {
      agent: job.agent,
      project: job.project,
      workingDir: job.workingDir,
      conversationId: job.conversationId,
      lastJobId: job.id
    });

    let pendingSteps = [];
    let updateTimer = null;

    const flushSteps = async () => {
      if (pendingSteps.length === 0) return;
      const batch = pendingSteps.splice(0, pendingSteps.length).join('\n');
      try {
        await thread.send(`\`\`\`\n${batch.slice(0, 1900)}\n\`\`\``);
      } catch (err) {
        console.warn('[DiscordUI] Failed to post step update:', err.message);
      }
    };

    const stepListener = ({ job: j, step }) => {
      if (j.id !== job.id) return;
      pendingSteps.push(`⚙️ ${step}`);
      if (!updateTimer) {
        updateTimer = setTimeout(() => {
          updateTimer = null;
          flushSteps();
        }, 3000);
      }
    };

    const finishListener = async (finishedJob) => {
      if (finishedJob.id !== job.id) return;

      this.agentRunner.off('job:step', stepListener);
      this.agentRunner.off('job:finish', finishListener);

      if (updateTimer) {
        clearTimeout(updateTimer);
        await flushSteps();
      }

      // Update session with final conversationId
      const session = this.threadSessions.get(thread.id);
      if (session) {
        session.conversationId = finishedJob.conversationId;
      }

      const isSuccess = finishedJob.status === 'success';
      const isCancelled = finishedJob.status === 'cancelled';

      const color = isSuccess ? 0x57F287 : (isCancelled ? 0xFEE75C : 0xED4245);
      const statusTitle = isSuccess ? '✅ Task Completed' : (isCancelled ? '⚠️ Task Cancelled' : '❌ Task Failed');

      const finishEmbed = new EmbedBuilder()
        .setTitle(statusTitle)
        .setColor(color)
        .addFields(
          { name: 'Duration', value: `${finishedJob.durationSeconds}s`, inline: true },
          { name: 'Exit Status', value: isSuccess ? 'Clean (0)' : (isCancelled ? 'Cancelled' : `Code ${finishedJob.exitCode}`), inline: true },
          { name: 'Changes Made', value: finishedJob.gitChanged ? '📝 Yes (files modified)' : 'None', inline: true }
        )
        .setTimestamp();

      if (finishedJob.diffStat) {
        finishEmbed.addFields({
          name: 'Git Diff Summary',
          value: `\`\`\`text\n${finishedJob.diffStat.slice(0, 1000)}\n\`\`\``
        });
      }

      // Check for last textual response
      if (finishedJob.logs && finishedJob.logs.length > 0) {
        const lastOutput = finishedJob.logs.join('').trim();
        if (lastOutput) {
          const preview = lastOutput.length > 1000 ? '...' + lastOutput.slice(-990) : lastOutput;
          finishEmbed.addFields({
            name: 'Recent Output',
            value: `\`\`\`text\n${preview}\n\`\`\``
          });
        }
      }

      finishEmbed.setFooter({ text: '💬 Reply directly to this thread with follow-up instructions to continue this session.' });

      try {
        await thread.send({ embeds: [finishEmbed] });
      } catch (err) {
        console.error('[DiscordUI] Failed to send finish embed:', err);
      }
    };

    this.agentRunner.on('job:step', stepListener);
    this.agentRunner.on('job:finish', finishListener);
  }

  getSession(threadId) {
    return this.threadSessions.get(threadId);
  }
}

module.exports = {
  DiscordUI
};
