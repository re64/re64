import { describe, it, expect } from "vitest";
import { Lease, SessionLeases, sessionKeyOf } from "./sessions.js";

const who = { userId: "usr_a", label: "Agent A" };

describe("holding a lease", () => {
  it("gives the same handle the same session across calls", () => {
    const leases = new SessionLeases();
    const first = leases.claim("k1", who);
    const second = leases.claim("k1", who);

    expect(second.id).toBe(first.id);
    expect(second.codename).toBe(first.codename);
  });

  it("gives different handles different sessions, even for one user", () => {
    // The whole point: one identity, many sessions — as one person has many
    // tabs. Two agents under one credential must not share an undo scope.
    const leases = new SessionLeases();
    const a = leases.claim("k1", who);
    const b = leases.claim("k2", who);

    expect(b.id).not.toBe(a.id);
    expect(b.codename).not.toBe(a.codename);
    expect(b.userId).toBe(a.userId);
  });

  it("names them memorably rather than numerically", () => {
    const leases = new SessionLeases();
    expect(leases.claim("k1", who).codename).toMatch(/^[a-z]+$/);
  });

  it("lets go after a long enough silence", () => {
    let clock = 1_000;
    const lapsed: Lease[] = [];
    const leases = new SessionLeases({
      idleMs: 100,
      now: () => clock,
      onLapsed: (l) => lapsed.push(l),
    });

    const first = leases.claim("k1", who);
    clock += 500;

    expect(leases.active()).toEqual([]);
    expect(lapsed.map((l) => l.id)).toEqual([first.id]);
    // A later call is a new session, not a resurrection.
    expect(leases.claim("k1", who).id).not.toBe(first.id);
  });

  it("keeps a lease alive as long as it is being used", () => {
    let clock = 1_000;
    const leases = new SessionLeases({ idleMs: 100, now: () => clock });
    const first = leases.claim("k1", who);

    for (let i = 0; i < 10; i++) {
      clock += 50;
      expect(leases.claim("k1", who).id).toBe(first.id);
    }
  });

  it("reuses a codename once nobody holds it", () => {
    let clock = 1_000;
    const leases = new SessionLeases({ idleMs: 100, now: () => clock });
    const first = leases.claim("k1", who);
    clock += 500;

    expect(leases.claim("k2", who).codename).toBe(first.codename);
  });

  it("keeps naming them when every name is taken at once", () => {
    const leases = new SessionLeases();
    const names = new Set<string>();
    for (let i = 0; i < 40; i++) names.add(leases.claim(`k${i}`, who).codename);

    expect(names.size).toBe(40);
  });

  it("announces a lease once, when it is issued", () => {
    const issued: Lease[] = [];
    const leases = new SessionLeases({ onIssued: (l) => issued.push(l) });
    leases.claim("k1", who);
    leases.claim("k1", who);
    leases.claim("k2", who);

    expect(issued).toHaveLength(2);
  });

  it("can be given up early", () => {
    const lapsed: Lease[] = [];
    const leases = new SessionLeases({ onLapsed: (l) => lapsed.push(l) });
    leases.claim("k1", who);
    leases.release("k1");

    expect(leases.active()).toEqual([]);
    expect(lapsed).toHaveLength(1);
    // Releasing something nobody holds is not an error.
    expect(() => leases.release("k1")).not.toThrow();
  });
});

describe("finding which lease a request wants", () => {
  it("prefers what the caller says over what the protocol says", () => {
    expect(
      sessionKeyOf({ "x-re64-session": "mine", "mcp-session-id": "theirs" }, "usr_a")
    ).toEqual({ key: "mine", explicit: true });
  });

  it("uses the protocol's session id when there is one", () => {
    expect(sessionKeyOf({ "mcp-session-id": "abc" }, "usr_a")).toEqual({
      key: "abc",
      explicit: true,
    });
  });

  it("falls back to the user, and says that it did", () => {
    // The weak case: every agent claiming this identity shares one lease and
    // therefore one undo scope. `explicit: false` is what makes that visible
    // rather than something to discover from behaviour.
    expect(sessionKeyOf({}, "usr_a")).toEqual({ key: "user:usr_a", explicit: false });
  });

  it("copes with a header arriving more than once", () => {
    expect(sessionKeyOf({ "mcp-session-id": ["a", "b"] }, "usr_a").key).toBe("a");
  });
});

describe("codenames a restart must not hand out again", () => {
  /**
   * Experiment 9, and the reason this is asserted rather than reasoned about.
   *
   * The server was rebuilt and restarted under three working agents. Everything
   * that lives in the document came back; the lease map did not, because it is
   * memory — so the pool began again at the top and the editor was issued
   * `basalt` while the reader holding `basalt` was still online. Three of its
   * messages are recorded in that project's chat as spoken by somebody else,
   * permanently, because chat records how an author was named at the time.
   */
  const who = { userId: "usr_a", label: "a" };

  it("skips a name the database remembers, even with nothing live", () => {
    const leases = new SessionLeases({ spentCodenames: () => ["agate", "amber"] });
    expect(leases.claim("one", who).codename).toBe("basalt");
  });

  it("still avoids names held right now", () => {
    const leases = new SessionLeases({ spentCodenames: () => ["agate"] });
    const first = leases.claim("one", who).codename;
    const second = leases.claim("two", who).codename;
    expect(first).toBe("amber");
    expect(second).toBe("basalt");
  });

  it("numbers past a pool that is entirely spent, without repeating", () => {
    // The suffix used to come from a counter that is also memory, so it
    // repeated after a restart exactly as the pool did.
    const spent = new Set<string>();
    const leases = new SessionLeases({
      spentCodenames: () => spent,
      onIssued: (lease) => spent.add(lease.codename),
    });

    const seen = new Set<string>();
    for (let i = 0; i < 70; i++) {
      const codename = leases.claim(`s${i}`, who).codename;
      expect(seen.has(codename)).toBe(false);
      seen.add(codename);
    }
    expect(seen.size).toBe(70);
    expect([...seen].some((name) => name.endsWith("-2"))).toBe(true);
  });
});
