const prism = require('prism-media');
const EventEmitter = require('events');

class AudioProcessor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.silenceThresholdMs = options.silenceThresholdMs || 900;
    this.minUtteranceMs = options.minUtteranceMs || 500;
    this.maxUtteranceMs = options.maxUtteranceMs || 25000;
    this.userBuffers = new Map();
  }

  // Convert 48kHz stereo 16-bit PCM into 16kHz mono WAV buffer
  static pcm48kStereoToWav16kMono(pcm48kStereo) {
    const numSamples48k = Math.floor(pcm48kStereo.length / 4);
    const numSamples16k = Math.floor(numSamples48k / 3);
    const pcm16k = Buffer.alloc(numSamples16k * 2);

    for (let i = 0; i < numSamples16k; i++) {
      const srcIdx = i * 3 * 4;
      const left = pcm48kStereo.readInt16LE(srcIdx);
      const right = pcm48kStereo.readInt16LE(srcIdx + 2);
      const mono = Math.round((left + right) / 2);
      pcm16k.writeInt16LE(mono, i * 2);
    }

    const header = Buffer.alloc(44);
    const dataLen = pcm16k.length;
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLen, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // subchunk1size (PCM = 16)
    header.writeUInt16LE(1, 20);  // audio format (PCM = 1)
    header.writeUInt16LE(1, 22);  // num channels (1 = mono)
    header.writeUInt32LE(16000, 24); // sample rate
    header.writeUInt32LE(32000, 28); // byte rate (16000 * 1 * 2)
    header.writeUInt16LE(2, 32);  // block align (1 * 16 / 8)
    header.writeUInt16LE(16, 34); // bits per sample
    header.write('data', 36);
    header.writeUInt32LE(dataLen, 40);

    return Buffer.concat([header, pcm16k]);
  }

  handleUserSpeaking(receiver, userId) {
    if (this.userBuffers.has(userId)) {
      return;
    }

    const opusStream = receiver.subscribe(userId, {
      end: {
        behavior: 'silence',
        duration: this.silenceThresholdMs
      }
    });

    const opusDecoder = new prism.opus.Decoder({
      rate: 48000,
      channels: 2,
      frameSize: 960
    });

    const pcmStream = opusStream.pipe(opusDecoder);
    const chunks = [];
    const startTime = Date.now();

    const state = {
      pcmStream,
      opusStream,
      startTime
    };
    this.userBuffers.set(userId, state);

    pcmStream.on('data', (chunk) => {
      chunks.push(chunk);
      if (Date.now() - startTime > this.maxUtteranceMs) {
        opusStream.destroy();
      }
    });

    const finishUtterance = () => {
      this.userBuffers.delete(userId);
      const durationMs = Date.now() - startTime;
      if (chunks.length === 0 || durationMs < this.minUtteranceMs) {
        return;
      }

      const totalPcm = Buffer.concat(chunks);
      try {
        const wavBuffer = AudioProcessor.pcm48kStereoToWav16kMono(totalPcm);
        this.emit('utterance', {
          userId,
          durationMs,
          wavBuffer
        });
      } catch (err) {
        console.error(`[AudioProcessor] Error encoding WAV for user ${userId}:`, err);
      }
    };

    pcmStream.on('end', finishUtterance);
    pcmStream.on('close', finishUtterance);
    pcmStream.on('error', (err) => {
      console.warn(`[AudioProcessor] PCM stream error for user ${userId}:`, err.message);
      this.userBuffers.delete(userId);
    });
  }
}

module.exports = {
  AudioProcessor
};
