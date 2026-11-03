const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

class AgentRunner extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.activeJobs = new Map();
    this.jobCounter = 0;
  }

  getGitState(dir) {
    if (!fs.existsSync(path.join(dir, '.git'))) {
      return null;
    }
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir, encoding: 'utf8' }).trim();
      const status = execSync('git status --porcelain', { cwd: dir, encoding: 'utf8' }).trim();
      return { branch, status };
    } catch {
      return null;
    }
  }

  getGitDiffStat(dir) {
    if (!fs.existsSync(path.join(dir, '.git'))) {
      return '';
    }
    try {
      return execSync('git diff --stat HEAD', { cwd: dir, encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  }

  resolveProjectPath(projectInput) {
    if (!projectInput) {
      const def = this.config.defaultProject;
      return this.config.projectAliases[def] || path.join(this.config.srcDir, def);
    }

    const clean = projectInput.toLowerCase().trim();
    if (this.config.projectAliases[clean]) {
      return this.config.projectAliases[clean];
    }

    const directPath = path.resolve(this.config.srcDir, projectInput);
    if (fs.existsSync(directPath)) {
      return directPath;
    }

    // Try finding close substring match
    for (const [name, p] of Object.entries(this.config.projectAliases)) {
      if (name.includes(clean) || clean.includes(name)) {
        return p;
      }
    }

    return this.config.srcDir;
  }

  startJob({ prompt, agent = 'agy', project = null, user = 'unknown', conversationId = null }) {
    const jobId = ++this.jobCounter;
    const workingDir = this.resolveProjectPath(project);
    const projectName = path.basename(workingDir);
    const startTime = Date.now();

    const initialGit = this.getGitState(workingDir);

    let command = '';
    let args = [];

    if (agent === 'agy') {
      command = 'agy';
      args = ['-p', prompt, '--output-format', 'stream-json', '--dangerously-skip-permissions'];
      if (conversationId) {
        args.push('--conversation', conversationId);
      }
    } else if (agent === 'claude') {
      command = 'claude';
      args = ['-p', prompt, '--dangerously-skip-permissions'];
      if (conversationId) {
        args.push('--continue');
      }
    } else if (agent === 'codex') {
      command = 'codex';
      args = ['exec', prompt];
    } else {
      throw new Error(`Unsupported agent: ${agent}`);
    }

    const job = {
      id: jobId,
      agent,
      prompt,
      project: projectName,
      workingDir,
      user,
      startTime,
      conversationId: conversationId || null,
      status: 'running',
      steps: [],
      logs: [],
      process: null
    };

    console.log(`[AgentRunner] Starting Job #${jobId} [${agent}] in ${workingDir} by ${user}`);

    const child = spawn(command, args, {
      cwd: workingDir,
      env: Object.assign({}, process.env, {
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8'
      })
    });

    job.process = child;
    this.activeJobs.set(jobId, job);

    this.emit('job:start', job);

    let stdoutBuffer = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      job.logs.push(text);

      if (agent === 'agy') {
        stdoutBuffer += text;
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop(); // keep remainder

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.event === 'init' && ev.conversation_id) {
              job.conversationId = ev.conversation_id;
            } else if (ev.event === 'step_update' && ev.step_update) {
              const su = ev.step_update;
              if (su.step_type === 'tool' && su.tool_info) {
                const stepDesc = `Running tool: ${su.tool_name} (${JSON.stringify(su.tool_info.parameters || {})})`;
                job.steps.push(stepDesc);
                this.emit('job:step', { job, step: stepDesc });
              }
            } else if (ev.event === 'result') {
              job.result = ev.result;
            }
          } catch {
            // Raw text log
            this.emit('job:log', { job, text: line });
          }
        }
      } else {
        this.emit('job:log', { job, text });
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      job.logs.push(`[stderr] ${text}`);
      this.emit('job:log', { job, text: `[stderr] ${text}` });
    });

    // Timeout guard
    const timeoutHandle = setTimeout(() => {
      if (job.status === 'running') {
        console.warn(`[AgentRunner] Job #${jobId} timed out after ${this.config.agentTimeoutSeconds}s`);
        this.cancelJob(jobId, 'Job execution timed out');
      }
    }, this.config.agentTimeoutSeconds * 1000);

    child.on('close', (code, signal) => {
      clearTimeout(timeoutHandle);
      this.activeJobs.delete(jobId);

      const durationMs = Date.now() - startTime;
      job.durationSeconds = Math.round(durationMs / 1000);
      job.exitCode = code;
      job.signal = signal;
      job.status = code === 0 ? 'success' : (job.status === 'cancelled' ? 'cancelled' : 'failed');

      // Check git changes
      const diffStat = this.getGitDiffStat(workingDir);
      const postGit = this.getGitState(workingDir);
      job.diffStat = diffStat;
      job.gitChanged = postGit && initialGit ? postGit.status !== initialGit.status : false;

      console.log(`[AgentRunner] Job #${jobId} finished with status=${job.status} in ${job.durationSeconds}s`);
      this.emit('job:finish', job);
    });

    child.on('error', (err) => {
      clearTimeout(timeoutHandle);
      this.activeJobs.delete(jobId);
      job.status = 'failed';
      job.error = err.message;
      console.error(`[AgentRunner] Failed to start Job #${jobId}:`, err);
      this.emit('job:error', { job, error: err });
    });

    return job;
  }

  cancelJob(jobId, reason = 'Cancelled by user') {
    const job = this.activeJobs.get(jobId);
    if (!job || !job.process) return false;

    job.status = 'cancelled';
    job.cancelReason = reason;

    try {
      job.process.kill('SIGTERM');
      setTimeout(() => {
        if (!job.process.killed) {
          job.process.kill('SIGKILL');
        }
      }, 3000);
      return true;
    } catch {
      return false;
    }
  }

  getActiveJobs() {
    return Array.from(this.activeJobs.values()).map(j => ({
      id: j.id,
      agent: j.agent,
      project: j.project,
      user: j.user,
      runningForSeconds: Math.round((Date.now() - j.startTime) / 1000),
      prompt: j.prompt.slice(0, 100)
    }));
  }
}

module.exports = {
  AgentRunner
};
