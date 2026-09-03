/**
 * One-shot tokens for uploading a binary over HTTP.
 *
 * Bytes do not belong in a tool call. A D64 is 175KB, which is ~233KB of
 * base64 and something like 58k tokens through a model's context for a file it
 * never needs to read — so `prepare_upload` hands back a URL and the bytes go
 * over HTTP, never through the transcript.
 *
 * **The token is bound to the project, the name and the caller before the bytes
 * arrive.** That is the whole reason it carries them: a project-less upload
 * would allow bytes to exist with no owner and no link, in a system whose
 * entire identity story is that every edit is attributable. Here the upload
 * *completes* the link, so an unlinked blob cannot be created — if the upload
 * never happens the token simply expires and nothing was made.
 *
 * **A token is not authentication, and should not be mistaken for it.** This
 * server has none: identity is a header it believes. What a single-use expiring
 * token buys is that an accidental or blind POST cannot fill the disk, and that
 * the shape is right for when real auth arrives. It is not protecting anything
 * today.
 *
 * Process-local and never persisted, like a session lease: a token outliving a
 * restart would be a credential nobody can see or revoke.
 */

import { randomBytes } from "node:crypto";

/** Long enough to fetch a file and send it; short enough to be forgotten. */
const DEFAULT_TTL_MS = 10 * 60 * 1000;

/**
 * The most a single upload may carry.
 *
 * A D64 is 175,531 bytes and a D81 is 819,200; the cap is well clear of both
 * while still refusing a mistake early rather than after several megabytes.
 */
export const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

export interface PreparedUpload {
  token: string;
  projectId: string;
  name: string;
  /** Who asked, so the resulting edit is attributed to them and not to nobody. */
  author: string;
  expiresAt: number;
}

export class UploadTokens {
  private readonly held = new Map<string, PreparedUpload>();

  constructor(
    private readonly options: { ttlMs?: number; now?: () => number } = {}
  ) {}

  private get now(): number {
    return (this.options.now ?? Date.now)();
  }

  issue(projectId: string, name: string, author: string): PreparedUpload {
    this.sweep();
    const prepared: PreparedUpload = {
      token: randomBytes(24).toString("hex"),
      projectId,
      name,
      author,
      expiresAt: this.now + (this.options.ttlMs ?? DEFAULT_TTL_MS),
    };
    this.held.set(prepared.token, prepared);
    return prepared;
  }

  /**
   * Spend a token. Single use: a second attempt finds nothing.
   *
   * Consumed before the bytes are stored rather than after, so a failed or
   * abandoned upload cannot be retried against the same token — the caller
   * prepares another, which costs nothing and leaves a clearer record.
   */
  claim(token: string): PreparedUpload | undefined {
    this.sweep();
    const held = this.held.get(token);
    if (!held) return undefined;
    this.held.delete(token);
    return held;
  }

  private sweep(): void {
    const now = this.now;
    for (const [token, held] of this.held) {
      if (held.expiresAt <= now) this.held.delete(token);
    }
  }

  get size(): number {
    this.sweep();
    return this.held.size;
  }
}

/**
 * The server's own token store.
 *
 * A module singleton because the two halves live in different places — the MCP
 * tool issues, the HTTP route spends — and threading one instance between them
 * would be ceremony for state that is process-local either way.
 */
export const uploadTokens = new UploadTokens();
