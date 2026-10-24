import { useCallback, useEffect, useRef } from 'react';

// Tells the other person "I'm typing" (throttled) and "I stopped" (after a pause / on send / on unmount).
export default function useTypingEmitter(friendId, sendTyping) {
  const lastSent = useRef(0);
  const offTimer = useRef(null);
  const active = useRef(null);

  const stop = useCallback(() => {
    clearTimeout(offTimer.current);
    if (active.current) { sendTyping(active.current, false); active.current = null; }
    lastSent.current = 0;
  }, [sendTyping]);

  const onInput = useCallback((value) => {
    if (!friendId) return;
    if (!value) { stop(); return; }
    const now = Date.now();
    if (now - lastSent.current > 2000) {            // throttle typing events
      lastSent.current = now;
      active.current = friendId;
      sendTyping(friendId, true);
    }
    clearTimeout(offTimer.current);
    offTimer.current = setTimeout(stop, 2500);
  }, [friendId, sendTyping, stop]);

  // Switching conversation or leaving the page must not leave "typing…" stuck on the other side.
  useEffect(() => () => stop(), [friendId, stop]);

  return { onInput, stop };
}
