// Keeps the display awake (no screensaver/sleep) while practising. MIDI input
// doesn't count as user activity to Windows, so without this the screensaver
// can start mid-song.

let wanted = false;
let lock: WakeLockSentinel | null = null;

async function acquire() {
  if (!wanted || lock || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
  } catch {
    // Denied (e.g. battery saver); practice still works, the screen may just sleep
  }
}

// The browser releases the lock whenever the tab is hidden; take it back on return
document.addEventListener('visibilitychange', () => { void acquire(); });

export function keepScreenAwake(on: boolean) {
  wanted = on;
  if (on) void acquire();
  else if (lock) { void lock.release(); lock = null; }
}
