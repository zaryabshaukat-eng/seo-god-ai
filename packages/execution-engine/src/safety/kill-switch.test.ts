import { describe, expect, it } from 'vitest';
import { KillSwitch } from './kill-switch.js';

describe('kill switch', () => {
  it('starts clear', () => {
    const killSwitch = new KillSwitch();
    expect(killSwitch.isStopped('s1')).toBe(false);
    expect(killSwitch.state()).toEqual({ global: false, stores: {} });
  });

  it('per-store stop/resume is isolated', () => {
    const killSwitch = new KillSwitch();
    killSwitch.stop('s1');
    expect(killSwitch.isStopped('s1')).toBe(true);
    expect(killSwitch.isStopped('s2')).toBe(false);
    killSwitch.resume('s1');
    expect(killSwitch.isStopped('s1')).toBe(false);
  });

  it('global stop freezes every store', () => {
    const killSwitch = new KillSwitch();
    killSwitch.stop();
    expect(killSwitch.isStopped('any-store')).toBe(true);
    expect(killSwitch.state().global).toBe(true);
    killSwitch.resume();
    expect(killSwitch.isStopped('any-store')).toBe(false);
  });

  it('stopAll and resumeAll reset everything', () => {
    const killSwitch = new KillSwitch();
    killSwitch.stop('s1');
    killSwitch.stop('s2');
    killSwitch.stopAll();
    expect(killSwitch.isStopped('s3')).toBe(true);
    killSwitch.resumeAll();
    expect(killSwitch.isStopped('s3')).toBe(false);
    expect(killSwitch.isStopped('s1')).toBe(false);
    expect(killSwitch.state().stores).toEqual({});
  });

  it('stop with empty string acts globally', () => {
    const killSwitch = new KillSwitch();
    killSwitch.stop('');
    expect(killSwitch.isStopped('s1')).toBe(true);
    killSwitch.resume('');
    expect(killSwitch.isStopped('s1')).toBe(false);
  });
});
