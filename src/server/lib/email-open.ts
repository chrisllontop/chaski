// Smallest valid transparent GIF (35 bytes). Served for every pixel request —
// including unknown delivery ids — so mail clients never render a broken image.
const TRANSPARENT_GIF_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export const TRANSPARENT_GIF: Uint8Array = Uint8Array.from(atob(TRANSPARENT_GIF_BASE64), (c) =>
  c.charCodeAt(0),
);

export const openPixelUrl = (baseUrl: string, deliveryId: string): string =>
  `${baseUrl.replace(/\/+$/, '')}/t/o/${deliveryId}`;

// Delivery ids are 16 chars of CSPRNG output (~95 bits), so the id itself is
// the capability: knowing it is required to mark the delivery opened.
export const injectOpenPixel = (html: string, pixelUrl: string): string => {
  const img = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none" />`;
  const bodyClose = html.search(/<\/body\s*>/i);
  if (bodyClose === -1) return html + img;
  return html.slice(0, bodyClose) + img + html.slice(bodyClose);
};
