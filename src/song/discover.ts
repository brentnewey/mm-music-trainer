import { NsfPlayer, NTSC_FRAME_CYCLES, type DriverSpec } from '../emu/nsf';
import { FRAME_SECONDS } from './analyze';

export interface DiscoveredTrack {
  id: number;
  kind: 'song' | 'jingle';
  /** Seconds until silence, or the probe length if it was still playing */
  probeSeconds: number;
}

const PROBE_SECONDS = 20;
const QUIET_STOP_FRAMES = 120;

/**
 * Plays each candidate sound id briefly and keeps the ones that look like
 * music: several melodic channels in use for a reasonable duration.
 */
export function discoverTracks(image: Uint8Array, spec: DriverSpec, ids: number[], onProgress?: (done: number) => void): DiscoveredTrack[] {
  const player = new NsfPlayer(image, spec);
  const found: DiscoveredTrack[] = [];
  const fingerprints = new Set<string>();
  const probeFrames = Math.round(PROBE_SECONDS / FRAME_SECONDS);
  ids.forEach((id, idx) => {
    onProgress?.(idx);
    try {
      player.reset();
      player.requestSound(id);
      const melodicFrames = [0, 0, 0];
      let lastAudible = -1;
      let fp = 2166136261;
      let f = 0;
      for (; f < probeFrames; f++) {
        const writes = player.tick();
        if (f < 600) for (const w of writes) fp = Math.imul(fp ^ w, 16777619);
        player.apu.skip(Math.round(NTSC_FRAME_CYCLES));
        const s = player.snapshot();
        for (let c = 0; c < 3; c++) if (s[c].audible) melodicFrames[c]++;
        if (s.some((c) => c.audible)) lastAudible = f;
        if (f - lastAudible > QUIET_STOP_FRAMES) break;
      }
      const seconds = (lastAudible + 1) * FRAME_SECONDS;
      const channelsUsed = melodicFrames.filter((n) => n * FRAME_SECONDS > 0.75).length;
      if (channelsUsed < 2 || seconds < 2.5) return;
      const key = `${fp >>> 0}`;
      if (fingerprints.has(key)) return; // several ids can alias the same tune
      fingerprints.add(key);
      const stillPlaying = f >= probeFrames;
      found.push({ id, kind: stillPlaying ? 'song' : 'jingle', probeSeconds: seconds });
    } catch {
      // Ids that crash the driver are simply not music
    }
  });
  return found;
}
