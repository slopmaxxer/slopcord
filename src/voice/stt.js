const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

class SpeechToText {
  constructor(config = {}) {
    this.config = config;
    this.engine = config.sttEngine || 'groq';
    this.groqApiKey = config.groqApiKey || process.env.GROQ_API_KEY;
    this.openaiApiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
  }

  async transcribe(wavBuffer) {
    if (!wavBuffer || wavBuffer.length < 44) {
      return '';
    }

    if (this.groqApiKey) {
      return this.transcribeGroq(wavBuffer);
    }

    if (this.openaiApiKey) {
      return this.transcribeOpenAI(wavBuffer);
    }

    return this.transcribeLocal(wavBuffer);
  }

  async transcribeGroq(wavBuffer) {
    const formData = new FormData();
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    formData.append('file', blob, 'audio.wav');
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('temperature', '0.0');

    try {
      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.groqApiKey}`
        },
        body: formData
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Groq API error HTTP ${res.status}: ${errText}`);
      }

      const json = await res.json();
      return (json.text || '').trim();
    } catch (err) {
      console.error('[STT] Groq transcription error:', err.message);
      // Fallback to local if available
      return this.transcribeLocal(wavBuffer);
    }
  }

  async transcribeOpenAI(wavBuffer) {
    const formData = new FormData();
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    formData.append('file', blob, 'audio.wav');
    formData.append('model', 'whisper-1');

    try {
      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`
        },
        body: formData
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenAI API error HTTP ${res.status}: ${errText}`);
      }

      const json = await res.json();
      return (json.text || '').trim();
    } catch (err) {
      console.error('[STT] OpenAI transcription error:', err.message);
      return this.transcribeLocal(wavBuffer);
    }
  }

  async transcribeLocal(wavBuffer) {
    const tmpFile = path.join(os.tmpdir(), `slopcord-audio-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    fs.writeFileSync(tmpFile, wavBuffer);

    return new Promise((resolve) => {
      // Look for whisper-cli or whisper.cpp
      // Check for ggml model in common locations
      const possibleModels = [
        path.join(process.env.HOME || '/home/slop', '.local/share/whisper/ggml-base.en.bin'),
        path.join(process.env.HOME || '/home/slop', '.cache/whisper/ggml-base.en.bin'),
        '/var/lib/whisper/ggml-base.en.bin'
      ];

      let modelPath = possibleModels.find(p => fs.existsSync(p));

      const whisperBin = 'whisper-cli';

      if (!modelPath) {
        // Without preloaded model, if no local model found, log clean note
        fs.unlink(tmpFile, () => {});
        console.warn('[STT] Local whisper-cli model not found and no GROQ_API_KEY/OPENAI_API_KEY configured.');
        return resolve('');
      }

      execFile(whisperBin, ['-m', modelPath, '-f', tmpFile, '-nt', '--no-timestamps'], (err, stdout) => {
        fs.unlink(tmpFile, () => {});
        if (err) {
          console.warn('[STT] Local whisper-cli execution failed:', err.message);
          return resolve('');
        }
        resolve((stdout || '').trim());
      });
    });
  }
}

module.exports = {
  SpeechToText
};
