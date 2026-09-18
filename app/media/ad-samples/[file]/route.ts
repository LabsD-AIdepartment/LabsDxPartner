import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pitchModeEnabled } from '@/server/platform/pitch-mode';
import { authorizePitchRequest } from '@/server/platform/pitch-access';
export const dynamic = 'force-dynamic';
const files: Record<string, string> = {
  'tendrix-video.mp4': 'video/mp4',
  'tendrix-video-poster.jpg': 'image/jpeg',
  'tendrix-graphic.jpg': 'image/jpeg',
};
export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  if (!pitchModeEnabled()) return new Response(null, { status: 404 });
  const denied = await authorizePitchRequest(request, false);
  if (denied) return denied;
  const { file } = await params;
  if (!Object.hasOwn(files, file)) return new Response(null, { status: 404 });
  try {
    const bytes = await readFile(resolve(process.env.LABSD_HOSTED_DATA_DIR ? resolve(process.env.LABSD_HOSTED_DATA_DIR, 'media') : resolve(process.cwd(), '.local/pitch/media'), file));
    return new Response(bytes, {
      headers: {
        'content-type': files[file],
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
