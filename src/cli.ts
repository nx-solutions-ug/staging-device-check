// Entry of `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" <command>`. The commands (set-secret, doctor, prepare, run,
// report) arrive with the CLI task; until then this entry only gives the build and the dist check their target.
process.stderr.write('staging-device-check: no commands yet\n');
process.exitCode = 64;
