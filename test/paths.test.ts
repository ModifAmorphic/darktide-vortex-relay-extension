import { describe, expect, it } from 'vitest';

import { DEPLOY_DIR_NAME, LOAD_ORDER_DIR_NAME, MOD_ROOT_DIR_NAME } from '../src/constants';
import { deployDir, loadOrderDir, modRoot, modsContentDir, relayDir } from '../src/paths';

// Production and CI run on Windows, so path.join emits backslashes; tests
// assert exact Windows strings.
const USER_DATA = 'C:\\Users\\Test\\AppData\\Roaming\\Vortex';

describe('paths', () => {
  describe('modRoot', () => {
    it('appends the mod-root segment under userData', () => {
      expect(modRoot(USER_DATA)).toBe(
        `C:\\Users\\Test\\AppData\\Roaming\\Vortex\\${MOD_ROOT_DIR_NAME}`,
      );
    });

    it('normalizes a trailing separator on input', () => {
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
      // modsContentDir is the <deployDir>/mods/ subtree Relay loads via
      // --mod-path <deployDir>.
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
      // relayDir resolves via __dirname, so the prefix is host-specific;
      // assert only the final segment.
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
