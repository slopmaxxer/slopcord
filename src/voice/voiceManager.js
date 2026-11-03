const { joinVoiceChannel, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const { AudioProcessor } = require('./audioProcessor');
const { SpeechToText } = require('./stt');
const { IntentParser } = require('./intentParser');
const { TextToSpeech } = require('./tts');

class VoiceManager {
  constructor(config, agentRunner, ui) {
    this.config = config;
    this.agentRunner = agentRunner;
    this.ui = ui;

    this.audioProcessor = new AudioProcessor();
    this.stt = new SpeechToText(config);
    this.intentParser = new IntentParser(config);
    this.tts = new TextToSpeech(config);

    this.connection = null;
    this.currentVoiceChannel = null;
    this.associatedTextChannel = null;

    this.setupUtteranceHandler();
  }

  async join(voiceChannel, textChannel = null) {
    if (this.connection) {
      if (this.currentVoiceChannel?.id === voiceChannel.id) {
        return this.connection;
      }
      this.leave();
    }

    console.log(`[Voice] Joining voice channel: ${voiceChannel.name} (${voiceChannel.id})`);

    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false
    });

    this.currentVoiceChannel = voiceChannel;
    this.associatedTextChannel = textChannel || voiceChannel.guild.systemChannel;

    this.tts.attachToConnection(this.connection);

    try {
      await entersState(this.connection, VoiceConnectionStatus.Ready, 20000);
      console.log(`[Voice] Connected and ready in ${voiceChannel.name}!`);
      this.tts.speak(`Connected. Slopcord agent is ready to listen.`);
    } catch (err) {
      console.error('[Voice] Failed to connect within timeout:', err);
      this.leave();
      throw err;
    }

    const receiver = this.connection.receiver;

    receiver.speaking.on('start', (userId) => {
      // Ignore bot's own speaking
      if (userId === voiceChannel.client.user.id) return;
      this.audioProcessor.handleUserSpeaking(receiver, userId);
    });

    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5000)
        ]);
      } catch {
        this.leave();
      }
    });

    return this.connection;
  }

  leave() {
    if (this.connection) {
      console.log(`[Voice] Leaving voice channel`);
      this.tts.stop();
      this.connection.destroy();
      this.connection = null;
      this.currentVoiceChannel = null;
      this.associatedTextChannel = null;
    }
  }

  setupUtteranceHandler() {
    this.audioProcessor.on('utterance', async ({ userId, wavBuffer, durationMs }) => {
      if (!this.connection || !this.currentVoiceChannel) return;

      try {
        const text = await this.stt.transcribe(wavBuffer);
        if (!text || text.length < 2) return;

        console.log(`[Voice STT] [User ${userId}] (${durationMs}ms): "${text}"`);

        // Resolve member username
        let username = 'voice-user';
        let member = null;
        try {
          member = await this.currentVoiceChannel.guild.members.fetch(userId);
          username = member.displayName || member.user.username;
        } catch {}

        if (!this.intentParser.isAuthorized(userId)) {
          console.warn(`[Voice] User ${username} (${userId}) is not authorized to run agent commands.`);
          return;
        }

        const intent = this.intentParser.parse(text, userId);
        if (!intent.triggered) {
          return;
        }

        console.log(`[Voice Intent] Triggered by ${username}! Agent=${intent.agent}, Project=${intent.project}, Prompt="${intent.prompt}"`);

        // Verbal acknowledgment in voice
        this.tts.speak(`On it, ${username}. Starting ${intent.agent} on ${intent.project}.`);

        // Create Discord thread in text channel
        const textChannel = this.associatedTextChannel || this.currentVoiceChannel.guild.systemChannel;
        let thread = null;
        if (textChannel && this.ui) {
          thread = await this.ui.createTaskThread(textChannel, {
            user: member?.user || { tag: username, id: userId },
            source: 'voice',
            agent: intent.agent,
            project: intent.project,
            prompt: intent.prompt,
            rawText: intent.rawText
          });
        }

        // Start agent job
        const job = this.agentRunner.startJob({
          prompt: intent.prompt,
          agent: intent.agent,
          project: intent.project,
          user: username
        });

        if (thread && this.ui) {
          this.ui.bindJobToThread(job, thread);
        }

        // Voice notification upon completion
        const onFinish = (finishedJob) => {
          if (finishedJob.id !== job.id) return;
          this.agentRunner.off('job:finish', onFinish);

          if (finishedJob.status === 'success') {
            const changes = finishedJob.gitChanged ? 'with changes applied' : 'completed';
            this.tts.speak(`Hey ${username}, the task on ${finishedJob.project} is ${changes}. Check the thread for details.`);
          } else if (finishedJob.status === 'cancelled') {
            this.tts.speak(`The task on ${finishedJob.project} was cancelled.`);
          } else {
            this.tts.speak(`Hey ${username}, the task on ${finishedJob.project} failed. Check the thread.`);
          }
        };

        this.agentRunner.on('job:finish', onFinish);

      } catch (err) {
        console.error('[Voice] Error processing utterance:', err);
      }
    });
  }
}

module.exports = {
  VoiceManager
};
