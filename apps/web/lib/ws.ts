export const connectStream = (projectId: string, token: string, onEvent: (data: any) => void) => {
  const url = new URL(`${process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:8081"}/ws/stream`);
  url.searchParams.set("projectId", projectId);
  url.searchParams.set("token", token);
  const ws = new WebSocket(url.toString().replace("http", "ws"));
  ws.onmessage = (msg) => onEvent(JSON.parse(msg.data));
  return ws;
};
