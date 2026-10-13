/** A command serve ran for the page: its JSON answer, or its refusal's error and help lines. */
export type Sent = { ok: true; answer: any } | { ok: false; error: string; help: string[] };

/** Ask serve to run a command, `body` as JSON. */
export async function send(method: string, path: string, body?: unknown): Promise<Sent> {
  try {
    const response = await fetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    const answer = await response.json();
    if (response.ok) return { ok: true, answer };
    return { ok: false, error: answer.error ?? `${path} answered ${response.status}`, help: answer.help ?? [] };
  } catch {
    return { ok: false, error: "Could not reach nico-agent serve.", help: ["Check that `nico-agent serve` is running, then try again."] };
  }
}

/** Set the Repo `slug`'s own settings, `body` as `PATCH /api/repo/<slug>` takes it; it answers the Repo's settings after. */
export const patch = (slug: string, body: Record<string, unknown>) => send("PATCH", `/api/repo/${slug}`, body);

/** Set the Project `name`'s defaults, `body` as `PATCH /api/project/<name>` takes it; it answers its settings after. */
export const patchProject = (name: string, body: Record<string, unknown>) => send("PATCH", `/api/project/${encodeURIComponent(name)}`, body);
