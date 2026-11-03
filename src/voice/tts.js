const { createAudioResource, createAudioPlayer, AudioPlayerStatus, entersState } = require('@discordjs/voice');
const { EdgeTTS } = require('node-edge-tts');
const fs = require('fs');
const path = require('path');
const os = require('os');

class TextToSpeech {
  constructor(config = {}) {
    this.config = config;
    this.voice = config.ttsVoice || 'en-US-ChristopherNeural';
    this.rate = config.ttsRate || '+0%';
    this.queue = [];
    this.isSpeaking = false;
    this.player = createAudioPlayer();

    this.player.on(AudioPlayerStatus.Idle, () => {
      this.isSpeaking = false;
      this.processQueue();
    });

    this.player.on('error', (err) => {
      console.error('[TTS] Audio player error:', err.message);
      this.isSpeaking = false;
      this.processQueue();
    });
  }

  attachToConnection(connection) {
    this.connection = connection;
    connection.subscribe(this.player);
  }

  speak(text) {
    if (!text || typeof text !== 'string') return;
    this.queue.push(text.trim());
    if (!this.isSpeaking) {
      this.processQueue();
    }
  }

  async processQueue() {
    if (this.queue.length === 0 || this.isSpeaking || !this.connection) {
      return;
    }

    const text = this.queue.shift();
    this.isSpeaking = true;

    const tmpFile = path.join(os.tmpdir(), `slopcord-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);

    try {
      const tts = new EdgeTTS({
        voice: this.voice,
        rate: this.rate
      });

      await tts.ttsPromise(text, tmpFile);

      if (!fs.existsSync(tmpFile) || fs.statSync(tmpFile).size === 0) {
        throw new Error('Generated TTS file is empty');
      }

      const stream = fs.createReadStream(tmpFile);
      const resource = createAudioResource(stream);

      this.player.play(resource);

      // Clean up tmp file once finished playing
      const cleanup = () => {
        try {
          if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        } catch {}
      };

      stream.on('close', cleanup);
      stream.on('error', cleanup);
    } catch (err) {
      console.error('[TTS] Failed to generate/play speech:', err.message);
      try {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      } catch {}
      this.isSpeaking = false;
      this.processQueue();
    }
  }

  stop() {
    this.queue = [];
    this.isSpeaking = false;
    this.player.stop();
  }
}

module.exports = {
  TextToSpeech
};
