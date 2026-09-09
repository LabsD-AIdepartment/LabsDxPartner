/** Read network input before the credential writer lock; a slow body cannot hold it. */
export async function boundedRequest(request: Request): Promise<Request | Response> {
  if (!request.body) return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('body-timeout')), 5000);
  });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > 8192) return Response.json({ code: 'INVALID_REQUEST' }, { status: 413 });
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new Request(request, { body });
  } catch (error) {
    return Response.json(
      { code: 'INVALID_REQUEST' },
      { status: error instanceof Error && error.message === 'body-timeout' ? 408 : 400 },
    );
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
