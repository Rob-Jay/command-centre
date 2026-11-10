/** Marks a tool-activity line inside a streamed reply ("Read app/page.tsx"). */
export const TOOL_MARK = "\u001e";

/** Split a streamed reply into display text and the tool calls Claude made along the way. */
export function splitToolMarks(raw: string): { text: string; tools: string[] } {
  const tools: string[] = [];
  const text = raw.replace(new RegExp(`${TOOL_MARK}([^\\n]*)\\n?`, "g"), (_, t: string) => {
    tools.push(t);
    return "";
  });
  return { text: text.replace(/\n{3,}/g, "\n\n"), tools };
}

/** POST JSON and feed the plain-text streamed response to `onChunk`. Returns the full text. */
export async function streamText(
  url: string,
  body: unknown,
  onChunk: (fullSoFar: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const msg = await res.text().catch(() => "");
    throw new Error(msg || `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onChunk(text);
  }
  return text;
}
