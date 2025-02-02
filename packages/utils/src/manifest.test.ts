import { promises as fs } from 'fs';
import { join } from 'path';
import {
  checkManifest,
  fixManifest,
  getSnapSourceCode,
  getWritableManifest,
} from './manifest';
import {
  NpmSnapFileNames,
  SnapFiles,
  SnapValidationFailureReason,
} from './types';
import { readJsonFile } from './fs';
import {
  DEFAULT_SNAP_BUNDLE,
  DEFAULT_SNAP_ICON,
  getPackageJson,
  getSnapManifest,
} from './__test__';
import { SnapManifest } from './json-schemas';
import { ProgrammaticallyFixableSnapError } from './snaps';
import * as npm from './npm';

jest.mock('fs');

const BASE_PATH = '/snap';
const MANIFEST_PATH = join(BASE_PATH, NpmSnapFileNames.Manifest);
const PACKAGE_JSON_PATH = join(BASE_PATH, NpmSnapFileNames.PackageJson);

/**
 * Clears out all the files in the in-memory file system, and writes the default
 * files to the `BASE_PATH` folder, including sub-folders.
 */
async function resetFileSystem() {
  await fs.rm(BASE_PATH, { recursive: true, force: true });

  // Create `dist` and `images` folders.
  await fs.mkdir(join(BASE_PATH, 'dist'), { recursive: true });
  await fs.mkdir(join(BASE_PATH, 'images'), { recursive: true });

  // Write default files.
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(getSnapManifest()));
  await fs.writeFile(PACKAGE_JSON_PATH, JSON.stringify(getPackageJson()));
  await fs.writeFile(join(BASE_PATH, 'dist/bundle.js'), DEFAULT_SNAP_BUNDLE);
  await fs.writeFile(join(BASE_PATH, 'images/icon.svg'), DEFAULT_SNAP_ICON);
}

describe('checkManifest', () => {
  beforeEach(async () => {
    await resetFileSystem();
  });

  it('returns the status and warnings after processing', async () => {
    const { updated, warnings } = await checkManifest(BASE_PATH);
    expect(updated).toBe(false);
    expect(warnings).toHaveLength(0);
  });

  it('updates and writes the manifest', async () => {
    await fs.writeFile(
      MANIFEST_PATH,
      JSON.stringify(
        getSnapManifest({
          shasum: '29MYwcRiruhy9BEJpN/TBIhxoD3t0P4OdXztV9rW8tc=',
        }),
      ),
    );

    const { manifest, updated, warnings } = await checkManifest(BASE_PATH);
    expect(manifest).toStrictEqual(getSnapManifest());
    expect(updated).toBe(true);
    expect(warnings).toHaveLength(0);

    const { source } = await readJsonFile<SnapManifest>(MANIFEST_PATH);
    expect(source.shasum).toBe('O4sADgTDj5EP86efVtOEI76NkKZeoKHRzQIlB1j48Lg=');
  });

  it('fixes multiple problems in the manifest', async () => {
    await fs.writeFile(
      MANIFEST_PATH,
      JSON.stringify(
        getSnapManifest({
          version: '0.0.1',
          shasum: '29MYwcRiruhy9BEJpN/TBIhxoD3t0P4OdXztV9rW8tc=',
        }),
      ),
    );

    const { manifest, updated, warnings } = await checkManifest(BASE_PATH);
    expect(manifest).toStrictEqual(getSnapManifest());
    expect(updated).toBe(true);
    expect(warnings).toHaveLength(0);

    const { source, version } = await readJsonFile<SnapManifest>(MANIFEST_PATH);
    expect(source.shasum).toBe('O4sADgTDj5EP86efVtOEI76NkKZeoKHRzQIlB1j48Lg=');
    expect(version).toBe('1.0.0');
  });

  it('returns a warning if package.json is missing recommended fields', async () => {
    await fs.writeFile(
      PACKAGE_JSON_PATH,
      JSON.stringify(getPackageJson({ repository: null })),
    );

    const { updated, warnings } = await checkManifest(BASE_PATH);
    expect(updated).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch('Missing recommended package.json properties');
  });

  it('return errors if the manifest is invalid', async () => {
    await fs.writeFile(
      MANIFEST_PATH,
      JSON.stringify(
        getSnapManifest({
          version: '0.0.1',
          shasum: '29MYwcRiruhy9BEJpN/TBIhxoD3t0P4OdXztV9rW8tc=',
        }),
      ),
    );

    const { manifest, updated, errors, warnings } = await checkManifest(
      BASE_PATH,
      false,
    );

    expect(manifest).toStrictEqual(getSnapManifest());
    expect(updated).toBe(true);
    expect(warnings).toHaveLength(0);

    expect(errors).toStrictEqual([
      '"snap.manifest.json" npm package version ("0.0.1") does not match the "package.json" "version" field ("1.0.0").',
      '"snap.manifest.json" "shasum" field does not match computed shasum.',
    ]);
  });

  it('throws an error if the error is not programmatically fixable', async () => {
    jest.spyOn(npm, 'validateNpmSnap').mockImplementation(() => {
      throw new Error('foo');
    });

    await expect(checkManifest(BASE_PATH)).rejects.toThrow('foo');
  });

  it('throws an error if writing the manifest fails', async () => {
    jest.spyOn(fs, 'writeFile').mockImplementation(() => {
      throw new Error('foo');
    });

    await expect(checkManifest(BASE_PATH)).rejects.toThrow(
      'Failed to update snap.manifest.json: foo',
    );
  });
});

describe('fixManifest', () => {
  it('fixes a name mismatch in the manifest', async () => {
    const files: SnapFiles = {
      manifest: getSnapManifest({ packageName: 'foo' }),
      packageJson: getPackageJson({ name: 'bar' }),
      sourceCode: DEFAULT_SNAP_BUNDLE,
    };

    const manifest = fixManifest(
      files,
      new ProgrammaticallyFixableSnapError(
        'foo',
        SnapValidationFailureReason.NameMismatch,
      ),
    );

    expect(manifest).toStrictEqual(getSnapManifest({ packageName: 'bar' }));
  });

  it('fixes a version mismatch in the manifest', async () => {
    const files: SnapFiles = {
      manifest: getSnapManifest({ version: '1' }),
      packageJson: getPackageJson({ version: '2' }),
      sourceCode: DEFAULT_SNAP_BUNDLE,
    };

    const manifest = fixManifest(
      files,
      new ProgrammaticallyFixableSnapError(
        'foo',
        SnapValidationFailureReason.VersionMismatch,
      ),
    );

    expect(manifest).toStrictEqual(getSnapManifest({ version: '2' }));
  });

  it('fixes a repository mismatch in the manifest', async () => {
    const files: SnapFiles = {
      manifest: getSnapManifest({ repository: { type: 'git', url: 'foo' } }),
      packageJson: getPackageJson({ repository: { type: 'git', url: 'bar' } }),
      sourceCode: DEFAULT_SNAP_BUNDLE,
    };

    const manifest = fixManifest(
      files,
      new ProgrammaticallyFixableSnapError(
        'foo',
        SnapValidationFailureReason.RepositoryMismatch,
      ),
    );

    expect(manifest).toStrictEqual(
      getSnapManifest({ repository: { type: 'git', url: 'bar' } }),
    );
  });

  it('fixes a shasum mismatch in the manifest', async () => {
    const files: SnapFiles = {
      manifest: getSnapManifest({
        shasum: '29MYwcRiruhy9BEJpN/TBIhxoD3t0P4OdXztV9rW8tc=',
      }),
      packageJson: getPackageJson(),
      sourceCode: DEFAULT_SNAP_BUNDLE,
    };

    const manifest = fixManifest(
      files,
      new ProgrammaticallyFixableSnapError(
        'foo',
        SnapValidationFailureReason.ShasumMismatch,
      ),
    );

    expect(manifest).toStrictEqual(getSnapManifest());
  });
});

describe('getSnapSourceCode', () => {
  beforeEach(async () => {
    await resetFileSystem();
  });

  it('returns the source code for a snap', async () => {
    expect(await getSnapSourceCode(BASE_PATH, getSnapManifest())).toBe(
      DEFAULT_SNAP_BUNDLE,
    );
  });

  it.each([
    [],
    {},
    undefined,
    null,
    { source: {} },
    { source: { location: {} } },
    { source: { location: { npm: {} } } },
  ])('returns undefined if an invalid manifest is passed', async (manifest) => {
    // @ts-expect-error Invalid manifest type.
    expect(await getSnapSourceCode(BASE_PATH, manifest)).toBeUndefined();
  });

  it('throws an error if the source code cannot be read', async () => {
    jest.spyOn(fs, 'readFile').mockImplementation(() => {
      throw new Error('foo');
    });

    await expect(
      getSnapSourceCode(BASE_PATH, getSnapManifest()),
    ).rejects.toThrow('Failed to read Snap bundle file: foo');
  });
});

describe('getWritableManifest', () => {
  it('sorts the manifest keys', () => {
    // This reverses the order of the keys in the manifest.
    // TODO: Replace `reduce` with `Object.fromEntries` when we support ES2019
    // or higher.
    const manifest = Object.entries(getSnapManifest())
      .reverse()
      .reduce(
        (target, [key, value]) => ({
          ...target,
          [key]: value,
        }),
        {} as SnapManifest,
      );

    const writableManifest = getWritableManifest(manifest);
    expect(Object.keys(writableManifest)).toStrictEqual(
      Object.keys(getSnapManifest()),
    );
  });
});
