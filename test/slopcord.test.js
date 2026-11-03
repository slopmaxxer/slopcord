const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { AudioProcessor } = require('../src/voice/audioProcessor');
const { IntentParser } = require('../src/voice/intentParser');
const { AgentRunner } = require('../src/agentRunner');
const { loadConfig } = require('../src/config');

test('AudioProcessor: 48kHz stereo to 16kHz mono WAV conversion', () => {
  // 1 second of 48kHz 16-bit stereo PCM = 48000 * 4 bytes = 192000 bytes
  const dummy48k = Buffer.alloc(48000 * 4);
  // Write alternating samples
  for (let i = 0; i < 48000; i++) {
    dummy48k.writeInt16LE(1000, i * 4);
    dummy48k.writeInt16LE(2000, i * 4 + 2);
  }

  const wav = AudioProcessor.pcm48kStereoToWav16kMono(dummy48k);

  // Expected 16000 samples * 2 bytes = 32000 bytes + 44 bytes header = 32044 bytes
  assert.strictEqual(wav.length, 32044);
  assert.strictEqual(wav.subarray(0, 4).toString(), 'RIFF');
  assert.strictEqual(wav.subarray(8, 12).toString(), 'WAVE');
  assert.strictEqual(wav.readUInt16LE(22), 1); // 1 channel (mono)
  assert.strictEqual(wav.readUInt32LE(24), 16000); // 16000 Hz sample rate
  assert.strictEqual(wav.readUInt16LE(34), 16); // 16 bits per sample

  // First mono sample should be average of 1000 and 2000 = 1500
  const firstSample = wav.readInt16LE(44);
  assert.strictEqual(firstSample, 1500);
});

test('IntentParser: trigger detection, agent selection, project extraction', () => {
  const config = {
    triggerWords: ['agent', 'antigravity', 'claude', 'slopcord'],
    defaultAgent: 'agy',
    defaultProject: 'slop-landing',
    projectAliases: {
      'mayfly': '/home/slop/src/mayfly',
      'landing': '/home/slop/src/slop-landing',
      'trough': '/home/slop/src/trough'
    },
    allowedUsers: ['user123']
  };

  const parser = new IntentParser(config);

  // Not triggered
  assert.strictEqual(parser.parse('Just chatting in discord with the crew', 'user123').triggered, false);

  // Triggered with explicit project and agent
  const res1 = parser.parse('Hey Antigravity, add a health check endpoint to mayfly please', 'user123');
  assert.strictEqual(res1.triggered, true);
  assert.strictEqual(res1.agent, 'agy');
  assert.strictEqual(res1.project, 'mayfly');
  assert.strictEqual(res1.projectPath, '/home/slop/src/mayfly');
  assert.match(res1.prompt, /add a health check endpoint/i);

  // Triggered with Claude
  const res2 = parser.parse('Claude, can you fix the routing in trough?', 'user123');
  assert.strictEqual(res2.triggered, true);
  assert.strictEqual(res2.agent, 'claude');
  assert.strictEqual(res2.project, 'trough');

  // Triggered without project and no prior context: defaults to defaultProject
  const res3 = parser.parse('Hey agent, update the styling', 'user456');
  assert.strictEqual(res3.triggered, true);
  assert.strictEqual(res3.project, 'slop-landing');

  // Authorization check
  assert.strictEqual(parser.isAuthorized('user123'), true);
  assert.strictEqual(parser.isAuthorized('unknown_user'), false);
});

test('AgentRunner: project path resolution', () => {
  const config = {
    srcDir: '/home/slop/src',
    defaultProject: 'slop-landing',
    projectAliases: {
      'mayfly': '/home/slop/src/mayfly',
      'slop-landing': '/home/slop/src/slop-landing'
    }
  };

  const runner = new AgentRunner(config);

  assert.strictEqual(runner.resolveProjectPath('mayfly'), '/home/slop/src/mayfly');
  assert.strictEqual(runner.resolveProjectPath(null), '/home/slop/src/slop-landing');
});

test('Config loader sets up paths and aliases', () => {
  const config = loadConfig();
  assert.ok(config.srcDir);
  assert.ok(config.projectAliases['landing']);
  assert.ok(config.projectAliases['fedi']);
  assert.ok(config.projectAliases['upload']);
});
