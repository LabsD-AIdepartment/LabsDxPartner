import { z } from 'zod';
import { createStatementExport, StatementExportTooLarge } from '@/server/modules/statements/export';
import { AccessFailure, type createPartnerAccess } from '@/server/modules/partners/access';
export function createStatementExportHttp(access: ReturnType<typeof createPartnerAccess>) {
  const prepare = createStatementExport(access);
  return async (request: Request, statementId: string) => {
    const headers = {
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    };
    if (request.method !== 'GET') return new Response(null, { status: 405, headers });
    try {
      const url = new URL(request.url);
      const file = await prepare(request.headers, {
        statementId,
        partnerId: url.searchParams.get('partnerId'),
        version: url.searchParams.get('version'),
      });
      const encoder = new TextEncoder();
      let index = -1;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (index === -1) {
            controller.enqueue(encoder.encode('\uFEFF'));
            index = 0;
          } else if (index < file.lines.length)
            controller.enqueue(encoder.encode(file.lines[index++]));
          else controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          ...headers,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${file.filename}"`,
        },
      });
    } catch (error) {
      const status =
        error instanceof StatementExportTooLarge
          ? 413
          : error instanceof z.ZodError
            ? 400
            : error instanceof AccessFailure
              ? error.code === 'unauthenticated'
                ? 401
                : error.code === 'conflict'
                  ? 409
                  : 403
              : 503;
      return Response.json(
        {
          code:
            status === 413 ? 'EXPORT_TOO_LARGE' : status === 503 ? 'UNAVAILABLE' : 'ACCESS_DENIED',
          message:
            status === 413
              ? 'รายการเกิน 10,000 แถว กรุณาเลือกช่วงที่สั้นลง'
              : 'ไม่สามารถดาวน์โหลดใบสรุปนี้ได้',
        },
        { status, headers },
      );
    }
  };
}
