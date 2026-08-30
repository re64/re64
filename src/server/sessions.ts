/**
 * Sessions as leases.
 *
 * A session here is not a property of a transport and not a person: it is a
 * server-side lease over a document, held by whoever presents a handle, and
 * given up by going quiet. A browser gets one from its socket; an agent gets
 * one from a header. Both then have the same three things — a stable identity
 * across calls, a name a person can read, and a scope for undo.
 *
 * This is what stops agents being second-class next to browser tabs, which was
 * the asymmetry worth removing: attribution by a bare string on one side and by
 * a session on the other is two mechanisms answering one question.
 *
 * It is deliberately *not* a session that owns a document. Agent operations
 * still apply straight to the room. This is identity and presence, not
 * isolation — isolation is what cloning a project is for.
 */

/**
 * Handles a person can hold in their head while reading a live transcript.
 *
 * Minerals: short, visually distinct from each other, and carrying no
 * implication about what the holder is or how good it is at the job. The list
 * is long enough that an experiment with five agents never has to fall back to
 * numbering.
 */
const CODENAMES = [
  "agate", "amber", "basalt", "beryl", "citrine", "cobalt", "coral", "flint",
  "garnet", "granite", "gypsum", "jade", "jasper", "lapis", "malachite", "marble",
  "nickel", "obsidian", "onyx", "opal", "peridot", "pumice", "pyrite", "quartz",
  "rutile", "shale", "slate", "spinel", "topaz", "tourmaline", "zircon", "zinc",
] as const;

export interface Lease {
  /** Stable across calls; what the ops log and the sessions table record. */
  readonly id: string;
  /** The memorable handle. A person cannot track a UUID in a live transcript. */
  readonly codename: string;
  /** Who claims to hold it. Unverified, exactly as elsewhere. */
  readonly userId: string;
  /** Their display name. */
  readonly label: string;
  /** When it was last used, so idleness can end it. */
  lastSeen: number;
}

export interface LeaseOptions {
  /**
   * How long a lease survives without being used.
   *
   * Generous by default: an agent's gap between turns is a property of whatever
   * is driving it, and handing the same caller a new identity mid-task would
   * split one piece of work across two names in the transcript.
   */
  idleMs?: number;
  now?: () => number;
  /** Called when a lease is first issued, so it can be written down. */
  onIssued?: (lease: Lease) => void;
  /** Called when one lapses, so presence can drop it. */
  onLapsed?: (lease: Lease) => void;
}

const DEFAULT_IDLE_MS = 30 * 60 * 1000;

export class SessionLeases {
  private readonly held = new Map<string, Lease>();
  private readonly idleMs: number;
  private readonly now: () => number;
  private issued = 0;

  constructor(private readonly options: LeaseOptions = {}) {
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Get the lease for a handle, making one if there is none.
   *
   * Expiry is swept here rather than on a timer: nothing needs to happen at the
   * moment a lease lapses, and a timer per session in a process that may hold
   * dozens is cost for no benefit.
   */
  claim(key: string, who: { userId: string; label: string }): Lease {
    this.sweep();

    const existing = this.held.get(key);
    if (existing) {
      existing.lastSeen = this.now();
      return existing;
    }

    const lease: Lease = {
      id: `ses_${this.nextId()}`,
      codename: this.freeCodename(),
      userId: who.userId,
      label: who.label,
      lastSeen: this.now(),
    };
    this.held.set(key, lease);
    this.options.onIssued?.(lease);
    return lease;
  }

  /** Everything still held, newest last. */
  active(): Lease[] {
    this.sweep();
    return [...this.held.values()];
  }

  /** Give one up early, when something knows it is finished. */
  release(key: string): void {
    const lease = this.held.get(key);
    if (!lease) return;
    this.held.delete(key);
    this.options.onLapsed?.(lease);
  }

  private sweep(): void {
    const cutoff = this.now() - this.idleMs;
    for (const [key, lease] of this.held) {
      if (lease.lastSeen < cutoff) {
        this.held.delete(key);
        this.options.onLapsed?.(lease);
      }
    }
  }

  /**
   * A codename nobody currently holds.
   *
   * Reused once a lease lapses, which is wanted — the pool should not drift
   * towards exhaustion over a long-running server. Numbered only if every name
   * is taken at once, which needs more concurrent sessions than the list.
   */
  private freeCodename(): string {
    const taken = new Set([...this.held.values()].map((l) => l.codename));
    const free = CODENAMES.find((name) => !taken.has(name));
    if (free) return free;
    return `${CODENAMES[this.issued % CODENAMES.length]}-${Math.floor(this.issued / CODENAMES.length) + 1}`;
  }

  private nextId(): string {
    this.issued += 1;
    return `${this.now().toString(36)}${this.issued.toString(36)}`;
  }
}

/**
 * Which lease a request is asking for.
 *
 * Order matters, and the fallback is the weak case. `Mcp-Session-Id` is the
 * protocol's own answer to "which instance": it is issued per client at
 * `initialize`, so several agents sharing one credential still get separate
 * sessions — one identity, many sessions, exactly as one person has many tabs.
 * An explicit `X-Re64-Session` lets a caller say so itself when the host does
 * not.
 *
 * Falling back to the user id is what happens when neither is offered, and it
 * is wrong in a specific way worth knowing: every agent claiming that identity
 * shares one lease, and therefore one undo scope. Whether that fallback is the
 * common case or the rare one depends on whether a host opens one MCP client
 * per agent, which is recorded in the transcript and not yet measured.
 */
export function sessionKeyOf(
  headers: Record<string, string | string[] | undefined>,
  userId: string
): { key: string; explicit: boolean } {
  const first = (name: string): string | undefined => {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
  };

  const claimed = first("x-re64-session") ?? first("mcp-session-id");
  return claimed ? { key: claimed, explicit: true } : { key: `user:${userId}`, explicit: false };
}
