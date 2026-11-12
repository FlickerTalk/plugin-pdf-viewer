// Nothing of the document travels here, only the page and a hello.

export const HELLO = "hello";
export const PAGE = "page";

export function encode(message) {
  let raw = "";
  for (const byte of new TextEncoder().encode(JSON.stringify(message))) raw += String.fromCharCode(byte);
  return btoa(raw);
}

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
