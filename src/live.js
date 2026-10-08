// What the viewer says to its twin on the other phone while a PDF is presented in a call (Plugin
// API 1.6.0, `onOpen.presenting`): the presenter's page, and a hello from a follower that just
// opened. JSON, then base64, as `ft.live.send` wants it. Nothing of the document travels here.

export const HELLO = "hello";
export const PAGE = "page";

/** A message as it travels. */
export function encode(message) {
  let raw = "";
  for (const byte of new TextEncoder().encode(JSON.stringify(message))) raw += String.fromCharCode(byte);
  return btoa(raw);
}

/** A message read back, reduced to what it may say; null when it is not one of ours. */
export function decode(data) {
  try {
    const bytes = Uint8Array.from(atob(String(data)), (one) => one.charCodeAt(0));
    const message = JSON.parse(new TextDecoder().decode(bytes));
    if (message?.k === HELLO) return { k: HELLO };
    if (message?.k === PAGE && Number.isInteger(message.n) && message.n >= 1) return { k: PAGE, n: message.n };
    return null;
  } catch {
    return null;
  }
}
