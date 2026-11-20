/// <reference types="node" />
// Tests only: a server on 127.0.0.1, ready before it is used. Listening on all addresses while the tests call
// 127.0.0.1 let another test file running at the same time take the same port number for 127.0.0.1, so a request
// could reach the wrong server (the cause of the intermittent "no login → 200" failures).
import type { Server } from 'http';
export const listenLocal = (app: { listen: (port: number, host: string, cb: () => void) => Server }): Promise<Server> =>
  new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
