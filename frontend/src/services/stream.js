import { BACKEND_URL } from './api';
import { userTimeZone } from '../utils/time';

// Streams the AI coach reply (Server-Sent Events over fetch) and calls onToken(text) as pieces arrive.
// Resolves { ok: true } when finished, { ok: false, fallback: true } when streaming could not start
// (the caller then uses the normal /ai/chat request), or { ok: false, message } for a real AI error.
export async function streamCoachReply(messages, { onToken, signal }) {
  let started = false;
  try {
    const res = await fetch(`${BACKEND_URL}/api/ai/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
        'X-Timezone': userTimeZone,
      },
      body: JSON.stringify({ messages }),
      signal,
    });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.includes('text/event-stream') || !res.body) {
      // JSON = a clear message from the server (AI off / not configured); anything else -> normal request
      if (res.ok && type.includes('application/json')) {
        const data = await res.json().catch(() => ({}));
        if (data.message) return { ok: false, message: data.message };
      }
      return { ok: false, fallback: true };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        const line = block.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line.slice(5)); } catch { continue; }
        if (evt.t) { started = true; onToken(evt.t); }
        else if (evt.error) return started ? { ok: true, partial: true } : { ok: false, message: evt.error };
        else if (evt.done) return { ok: true };
      }
    }
    return started ? { ok: true } : { ok: false, fallback: true };
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: true, aborted: true };
    return started ? { ok: true, partial: true } : { ok: false, fallback: true };
  }
}
