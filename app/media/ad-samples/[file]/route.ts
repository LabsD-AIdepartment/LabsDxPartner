import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pitchModeEnabled } from '@/server/platform/pitch-mode';
import { authorizePitchRequest } from '@/server/platform/pitch-access';
export const dynamic = 'force-dynamic';
const files: Record<string, string> = {
  'tendrix-video.mp4': 'video/mp4',
  'tendrix-video-poster.jpg': 'image/jpeg',
  'tendrix-graphic.jpg': 'image/jpeg',
};
type Context = { params: Promise<{ file: string }> };

// Unsupported/malformed ranges fall back to the complete representation.
// BigInt keeps oversized client offsets from rounding into a different range.
function byteRange(header: string | null, size: number) {
  if (!header || header.length > 256) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const total = BigInt(size);
  if (!match[1]) {
    const suffix = BigInt(match[2]);
    if (suffix === 0n || total === 0n) return 'unsatisfiable';
    return { start: Number(suffix >= total ? 0n : total - suffix), end: size - 1 };
  }
  const start = BigInt(match[1]);
  const end = match[2] ? BigInt(match[2]) : total - 1n;
  if (match[2] && end < start) return null;
  if (start >= total) return 'unsatisfiable';
  return { start: Number(start), end: Number(end >= total ? total - 1n : end) };
}

async function serve(request: Request, { params }: Context, head: boolean) {
  if (!pitchModeEnabled()) return new Response(null, { status: 404 });
  const denied = await authorizePitchRequest(request, false);
  if (denied) return denied;
  const { file } = await params;
  if (!Object.hasOwn(files, file)) return new Response(null, { status: 404 });
  try {
    const path = resolve(
      process.env.LABSD_HOSTED_DATA_DIR
        ? resolve(process.env.LABSD_HOSTED_DATA_DIR, 'media')
        : resolve(process.cwd(), '.local/pitch/media'),
      file,
    );
    const info = await stat(path);
    if (!info.isFile()) return new Response(null, { status: 404 });
    const headers = new Headers({
      'content-type': files[file],
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'accept-ranges': 'bytes',
      'content-length': String(info.size),
    });
    // No validators are advertised, so an If-Range request gets a full response.
    const range =
      head || request.headers.has('if-range')
        ? null
        : byteRange(request.headers.get('range'), info.size);
    if (range === 'unsatisfiable') {
      headers.set('content-range', `bytes */${info.size}`);
      headers.set('content-length', '0');
      return new Response(null, { status: 416, headers });
    }
    if (head) return new Response(null, { headers });
    if (range) {
      headers.set('content-range', `bytes ${range.start}-${range.end}/${info.size}`);
      headers.set('content-length', String(range.end - range.start + 1));
    }
    const stream = createReadStream(path, { ...range, signal: request.signal });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      status: range ? 206 : 200,
      headers,
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
export function GET(request: Request, context: Context) {
  return serve(request, context, false);
}
export function HEAD(request: Request, context: Context) {
  return serve(request, context, true);
}
