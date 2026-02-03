import { spawnSync } from 'node:child_process'

const args = ['--dir']

// Windows-only: electron-builder tries to extract winCodeSign (needs symlink privileges).
// Disabling sign/edit avoids downloading/extracting those tools for local dev packing.
if (process.platform === 'win32') {
  args.push('--config.win.signAndEditExecutable=false')
}

const result = spawnSync('electron-builder', args, { stdio: 'inherit', shell: true })
process.exit(typeof result.status === 'number' ? result.status : 1)

