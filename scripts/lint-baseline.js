const { spawn } = require('child_process');

const MAX_ERRORS = 7;
const MAX_WARNINGS = 2;

const args = ['eslint', 'src', '--ext', '.js,.jsx', '-f', 'json'];

// On Windows, npx is a cmd script (npx.cmd) and needs shell: true to resolve reliably
const isWin = process.platform === 'win32';
const cmd = isWin ? 'npx.cmd' : 'npx';

const child = spawn(cmd, args, {
  shell: isWin,
  stdio: ['ignore', 'pipe', 'inherit'],
});

let stdout = '';
child.stdout.on('data', (chunk) => {
  stdout += chunk;
});

child.on('close', () => {
  let report = [];
  try {
    report = JSON.parse(stdout || '[]');
  } catch (err) {
    console.error('Failed to parse ESLint JSON output:', err.message);
    process.exit(1);
  }

  const errors = report.reduce((sum, f) => sum + (f.errorCount || 0), 0);
  const warnings = report.reduce((sum, f) => sum + (f.warningCount || 0), 0);

  console.log(`Lint check: ${errors} errors, ${warnings} warnings (baseline: ${MAX_ERRORS} errors, ${MAX_WARNINGS} warnings)`);

  if (errors > MAX_ERRORS || warnings > MAX_WARNINGS) {
    console.error(`New lint issues detected above baseline! Errors: ${errors}/${MAX_ERRORS}, Warnings: ${warnings}/${MAX_WARNINGS}`);
    process.exit(1);
  }

  console.log('Lint check passed within baseline limits.');
  process.exit(0);
});

child.on('error', (err) => {
  console.error('Failed to run ESLint process:', err);
  process.exit(1);
});
