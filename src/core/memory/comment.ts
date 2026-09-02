/**
 * What someone wrote about an address.
 *
 * First-class, with an id, rather than a field on a label — because the two are
 * not the same thing and conflating them made the common case impossible.
 * Commenting an instruction meant inventing a label for it and polluting the
 * listing with a name nobody wanted, and a comment could not exist anywhere a
 * label did not.
 *
 * A region's `comment` is deliberately *not* this. It describes a span and is a
 * property of the region object alongside its name, so it is stored there and
 * rendered where the span begins. Different thing, different home — but it does
 * appear in the listing, because a description nobody can see is a parameter
 * that looks like it worked.
 */

/**
 * Where it goes relative to the row it is about.
 *
 * Placement is the only axis, and length follows from it: `before` and `after`
 * own their own rows and may run to several lines, an `inline` one shares a row
 * with an instruction and therefore cannot. Treating "long" and "short" as a
 * separate field would permit a long inline comment, which has no rendering.
 *
 * `after` exists because the reference writes `;Returns` on its own line below a
 * `JMP`: an observation about what happens next, which inline would attach to
 * the jump itself and say something slightly untrue about.
 */
export type CommentPlacement = "before" | "inline" | "after";

export interface Comment {
  /**
   * Stable identity, independent of where it points.
   *
   * An address cannot identify one: several comments can share an address, and
   * moving a comment has to be a field edit rather than delete-plus-create, for
   * the same reasons labels carry ids.
   */
  readonly id: string;
  readonly address: number;
  readonly placement: CommentPlacement;
  readonly text: string;
  /**
   * Where this sits among the comments sharing its address.
   *
   * Absent until somebody arranges them. Ordering was by id alone — stable and
   * identical on every peer, which is what merge needs, and arbitrary, which is
   * no use once several comments at one address is the *intended* flow rather
   * than an accident to be tidied away. Adding one is cheap and deciding the
   * running order is an editing pass, so the two have to be separable.
   *
   * A plain number, last-writer-wins per comment like every other field here.
   * Two peers arranging the same address concurrently converge on something
   * neither chose, which for prose is untidy rather than wrong.
   */
  readonly order?: number;
}

export function createComment(
  id: string,
  address: number,
  placement: CommentPlacement,
  text: string,
  order?: number
): Comment {
  return { id, address, placement, text, ...(order === undefined ? {} : { order }) };
}

/**
 * The comments in a project, by address.
 *
 * Every comment at an address is kept and rendered — there is no "primary
 * comment" and no index choosing one. That machinery exists for labels because
 * operand rendering has to substitute exactly one name for an address, a forced
 * single choice. Nothing forces a choice here: two comments can both be shown,
 * and a redundant pair is visible enough that whoever sees it removes one.
 *
 * Order within an address is by id. Arbitrary, but stable and identical on
 * every peer without coordination, which is what a shared document needs.
 */
export class CommentIndex {
  private readonly byAddress = new Map<number, Comment[]>();

  add(comment: Comment): void {
    const at = this.byAddress.get(comment.address) ?? [];
    at.push(comment);
    // Arranged order first, then id — so an unarranged comment keeps the old
    // stable-but-arbitrary behaviour and an arranged one wins over it.
    at.sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
    this.byAddress.set(comment.address, at);
  }

  addAll(comments: readonly Comment[]): void {
    for (const comment of comments) this.add(comment);
  }

  /** Comments at an address with the given placement, in stable order. */
  at(address: number, placement: CommentPlacement): readonly Comment[] {
    return (this.byAddress.get(address) ?? []).filter((c) => c.placement === placement);
  }

  /** Every comment at an address, whatever its placement, in rendered order. */
  allAt(address: number): readonly Comment[] {
    return this.byAddress.get(address) ?? [];
  }

  /** Whether anything is written about this address at all. */
  has(address: number): boolean {
    return (this.byAddress.get(address)?.length ?? 0) > 0;
  }

  all(): readonly Comment[] {
    return [...this.byAddress.values()].flat();
  }

  get size(): number {
    return this.all().length;
  }
}
