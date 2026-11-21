import http from "node:http";
import { callback_path } from "./endpoints.ts";

export type CallbackServer = {
  redirect_uri: string;
  result: Promise<URLSearchParams | null>;
  close: () => void;
};

const listen = (server: http.Server): Promise<number> =>
  new Promise((resolve, reject) => {
    const failed = (error: Error) => {
      server.off("listening", listening);
      reject(new Error(`the ChatGPT sign-in callback could not listen on 127.0.0.1: ${error.message}`, { cause: error }));
    };
    const listening = () => {
      server.off("error", failed);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("the ChatGPT sign-in callback listener reported no TCP address"));
        return;
      }
      resolve(address.port);
    };
    server.once("error", failed);
    server.once("listening", listening);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true });
  });

const answer = (response: http.ServerResponse, status: number, type: string, body: string) => {
  response.writeHead(status, {
    "Content-Type": `${type}; charset=utf-8`,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'",
    "Referrer-Policy": "no-referrer",
  });
  response.end(body);
};

export const start_callback_server = async (state: string, page: (received: boolean) => string): Promise<CallbackServer> => {
  const server = http.createServer();
  let settle: (params: URLSearchParams | null) => void = () => undefined;
  const result = new Promise<URLSearchParams | null>((resolve) => {
    settle = resolve;
  });
  let done = false;
  const close = () => {
    done = true;
    settle(null);
    server.close();
    server.closeAllConnections();
  };
  server.on("request", (request, response) => {
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://127.0.0.1");
    } catch {
      console.error(`[chatgpt] the sign-in callback listener refused a ${request.method ?? "request"} with an unparsable target`);
      answer(response, 400, "text/plain", "Bad request");
      return;
    }
    if (request.method !== "GET" || url.pathname !== callback_path) {
      answer(response, 404, "text/plain", "Not found");
      return;
    }
    if (done || url.searchParams.get("state") !== state) {
      answer(response, 400, "text/plain", "This sign-in link does not belong to the current attempt.");
      return;
    }
    done = true;
    settle(url.searchParams);
    response.on("finish", () => {
      server.close();
      server.closeIdleConnections();
    });
    answer(response, 200, "text/html", page(url.searchParams.has("code") && !url.searchParams.has("error")));
  });
  server.on("error", (error) => console.error("[chatgpt] the sign-in callback listener failed:", error.message));
  const port = await listen(server);
  return { redirect_uri: `http://127.0.0.1:${port}${callback_path}`, result, close };
};
