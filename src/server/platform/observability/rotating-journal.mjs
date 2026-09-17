import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

const segmentName = /^events-(\d{12})\.jsonl$/;

/** Capacity retention, not a financial audit store. Caller owns its namespace lock and event validation.
 * @param {{directory:string, maxBytes:number, maxFiles:number}} options
 * @param {(event:Record<string, unknown>) => void} validate
 */
export function createRotatingJournal({ directory, maxBytes, maxFiles }, validate) {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1024 ||
    maxBytes > 16 * 1024 * 1024 ||
    !Number.isSafeInteger(maxFiles) ||
    maxFiles < 1 ||
    maxFiles > 100
  )
    throw Error('Invalid journal limits');
  const path = resolve(directory);
  let directoryIdentity = null,
    currentName = null;
  let fd = null,
    size = 0,
    failed = false,
    closed = false,
    lastStoredSequence = null;
  function segments() {
    return readdirSync(path)
      .filter((name) => segmentName.test(name))
      .sort();
  }
  function checkFile(name) {
    const stat = lstatSync(resolve(path, name));
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.size > maxBytes)
      throw Error('Invalid journal file');
  }
  function ensureDirectory(name) {
    try {
      if (!lstatSync(name).isDirectory() || realpathSync(name) !== name)
        throw Error('Invalid journal ancestor');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ensureDirectory(dirname(name));
      mkdirSync(name, { mode: 0o700 });
    }
  }
  function checkDirectory() {
    const stat = lstatSync(path);
    if (
      !stat.isDirectory() ||
      realpathSync(path) !== path ||
      (stat.mode & 0o077) !== 0 ||
      (directoryIdentity &&
        (stat.ino !== directoryIdentity.ino || stat.dev !== directoryIdentity.dev))
    )
      throw Error('Invalid journal directory');
  }
  function checkOpenFile() {
    if (fd === null || currentName === null) throw Error('Journal file unavailable');
    const descriptor = fstatSync(fd),
      named = lstatSync(resolve(path, currentName));
    if (
      !named.isFile() ||
      descriptor.nlink !== 1 ||
      named.nlink !== 1 ||
      (named.mode & 0o077) !== 0 ||
      descriptor.ino !== named.ino ||
      descriptor.dev !== named.dev
    )
      throw Error('Journal file unavailable');
  }
  function closeFile() {
    if (fd !== null) {
      const old = fd;
      fd = null;
      closeSync(old);
    }
  }
  function rotate() {
    checkDirectory();
    closeFile();
    const names = segments();
    for (const name of names) checkFile(name);
    const next = names.length ? Number(segmentName.exec(names.at(-1))[1]) + 1 : 1;
    if (next > 999999999999) throw Error('Journal sequence exhausted');
    // Only our exact namespace is pruned; unrelated files never enter retention.
    while (names.length >= maxFiles) unlinkSync(resolve(path, names.shift()));
    currentName = `events-${String(next).padStart(12, '0')}.jsonl`;
    fd = openSync(
      resolve(path, currentName),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    size = 0;
  }
  try {
    ensureDirectory(path);
    directoryIdentity = lstatSync(path);
    rotate(); // Never append to a previous process's possibly incomplete final line.
  } catch {
    failed = true;
    try {
      closeFile();
    } catch {
      /* status exposes failure */
    }
  }
  return {
    /** Accept only the explicit sanitized formatter envelope; never raw child output.
     * @param {Record<string, unknown>} event
     */
    write(event) {
      if (failed || closed) return false;
      try {
        validate(event);
        const line = Buffer.from(JSON.stringify(event) + '\n');
        if (line.length > maxBytes || line.length > 4096) throw Error('Oversized journal event');
        checkDirectory();
        checkOpenFile();
        if (size + line.length > maxBytes) rotate();
        let offset = 0;
        while (offset < line.length) {
          const written = writeSync(fd, line, offset, line.length - offset);
          if (written <= 0) throw Error('Incomplete journal write');
          offset += written;
        }
        fsyncSync(fd);
        size += line.length;
        lastStoredSequence = event.sequence;
        return true;
      } catch {
        failed = true;
        try {
          closeFile();
        } catch {
          /* no raw filesystem error output */
        }
        return false;
      }
    },
    status() {
      // Stable service cycles may not emit a new event: still detect missing/replaced storage.
      if (!failed && !closed) {
        try {
          checkDirectory();
          checkOpenFile();
        } catch {
          failed = true;
          try {
            closeFile();
          } catch {}
        }
      }
      return { state: failed ? 'unavailable' : closed ? 'closed' : 'ready', lastStoredSequence };
    },
    close() {
      closed = true;
      try {
        closeFile();
      } catch {
        failed = true;
      }
    },
  };
}
