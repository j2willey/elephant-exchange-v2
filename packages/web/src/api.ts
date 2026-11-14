/** Talks to the server. Screens use this, never fetch directly, so tests can hand in a browser with a cookie jar. */
export function createApi(fetchFn: typeof fetch = (input, init) => fetch(input, init)) {
  const postJson = (path: string, body?: unknown) =>
    fetchFn(path, {
      method: "POST",
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });

  return {
    /** Who is signed in on this browser, if anyone. */
    async session(): Promise<{ email: string } | undefined> {
      const res = await fetchFn("/api/session");
      if (res.status === 401) return undefined;
      if (!res.ok) throw new Error(`session check failed: ${res.status}`);
      return (await res.json()) as { email: string };
    },

    async requestLink(email: string): Promise<"sent" | "tooMany" | "invalidEmail"> {
      const res = await postJson("/api/auth/link", { email });
      if (res.status === 202) return "sent";
      if (res.status === 429) return "tooMany";
      if (res.status === 400) return "invalidEmail";
      throw new Error(`asking for a link failed: ${res.status}`);
    },

    /** Uses up an emailed link; undefined if it was already used or has expired. */
    async redeemLink(token: string): Promise<{ email: string } | undefined> {
      const res = await postJson("/api/auth/verify", { token });
      if (res.status === 401 || res.status === 400) return undefined;
      if (!res.ok) throw new Error(`signing in failed: ${res.status}`);
      return (await res.json()) as { email: string };
    },

    async signOut(): Promise<void> {
      await postJson("/api/auth/sign-out");
    },
  };
}

export type Api = ReturnType<typeof createApi>;
