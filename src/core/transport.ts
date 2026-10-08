/** Sends one HTTP request, shaped like `fetch` */
export type Transport = (url: string, init: RequestInit) => Promise<Response>;

/** Global `fetch`, looked up per call so msw can intercept it */
export const fetchTransport: Transport = (url, init) => fetch(url, init);
