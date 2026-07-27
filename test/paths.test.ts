import { describe, expect, it } from 'vitest';

import { DEPLOY_DIR_NAME, LOAD_ORDER_DIR_NAME, MOD_ROOT_DIR_NAME } from '../src/constants';
import { deployDir, loadOrderDir, modRoot, modsContentDir, relayDir } from '../src/paths';

// Production is Windows-only and CI runs on Windows, so path.join produces
// backslash-separated output. Tests assert exact Windows strings.
const USER_DATA = 'C:\\Users\\Test\\AppData\\Roaming\\Vortex';

describe('paths', () => {
  describe('modRoot', () => {
    it('appends the mod-root segment under userData', () => {
      expect(modRoot(USER_DATA)).toBe(
        `C:\\Users\\Test\\AppData\\Roaming\\Vortex\\${MOD_ROOT_DIR_NAME}`,
      );
    });

    it('normalizes a trailing separator on input', () => {
      // path.join collapses the trailing backslash; output matches the
      // non-trailing-separator case exactly.
      expect(modRoot(`${USER_DATA}\\`)).toBe(
        `C:\\Users\\Test\\AppData\\Roaming\\Vortex\\${MOD_ROOT_DIR_NAME}`,
      );
    });
  });

  describe('deployDir', () => {
    it('appends the deploy segment under modRoot', () => {
      expect(deployDir(USER_DATA)).toBe(
        `C:\\Users\\Test\\AppData\\Roaming\\Vortex\\${MOD_ROOT_DIR_NAME}\\${DEPLOY_DIR_NAME}`,
      );
    });
  });

  describe('modsContentDir', () => {
    it('appends the mods segment under deployDir', () => {
      // Relay's --mod-path points at deployDir; the launcher expects
      // <deployDir>/mods/ to contain the mod folders and mods.lst.
      expect(modsContentDir(USER_DATA)).toBe(
        `C:\\Users\\Test\\AppData\\Roaming\\Vortex\\${MOD_ROOT_DIR_NAME}\\${DEPLOY_DIR_NAME}\\mods`,
      );
    });

    it('is a strict descendant of deployDir', () => {
      expect(modsContentDir(USER_DATA).startsWith(deployDir(USER_DATA))).toBe(true);
    });

    it('normalizes a trailing separator on input', () => {
      expect(modsContentDir(`${USER_DATA}\\`)).toBe(
        `C:\\Users\\Test\\AppData\\Roaming\\Vortex\\${MOD_ROOT_DIR_NAME}\\${DEPLOY_DIR_NAME}\\mods`,
      );
    });
  });

  describe('loadOrderDir', () => {
    it('appends the load-order segment under modRoot', () => {
      expect(loadOrderDir(USER_DATA)).toBe(
        `C:\\Users\\Test\\AppData\\Roaming\\Vortex\\${MOD_ROOT_DIR_NAME}\\${LOAD_ORDER_DIR_NAME}`,
      );
    });
  });

  describe('relayDir', () => {
    it('returns an absolute path ending with the relay segment', () => {
      // relayDir resolves via __dirname, so the exact prefix depends on
      // where the test process loaded the module from. The final
      // segment must be 'relay' (design.md, Relay tool).
      const result = relayDir();
      const segments = result.split(/[\\/]/);
      expect(segments[segments.length - 1]).toBe('relay');
    });

    it('returns the same result on repeated calls', () => {
      expect(relayDir()).toBe(relayDir());
    });
  });

  describe('purity', () => {
    it('returns the same result on repeated call (no observable side effects)', () => {
      const first = {
        root: modRoot(USER_DATA),
        deploy: deployDir(USER_DATA),
        modsContent: modsContentDir(USER_DATA),
        loadOrder: loadOrderDir(USER_DATA),
      };
      const second = {
        root: modRoot(USER_DATA),
        deploy: deployDir(USER_DATA),
        modsContent: modsContentDir(USER_DATA),
        loadOrder: loadOrderDir(USER_DATA),
      };
      expect(second).toEqual(first);
    });

    it('does not touch the filesystem', () => {
      // Pure-function smoke check: calling the helpers must not throw or
      // require any filesystem state to exist.
      expect(() => {
        modRoot(USER_DATA);
        deployDir(USER_DATA);
        modsContentDir(USER_DATA);
        loadOrderDir(USER_DATA);
        relayDir();
      }).not.toThrow();
    });
  });
});
