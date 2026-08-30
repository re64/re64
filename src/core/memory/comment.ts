/**
 * What someone wrote about an address.
 *
 * First-class, with an id, rather than a field on a label — because the two are
 * not the same thing and conflating them made the common case impossible.
 * Commenting an instruction meant inventing a label for it and polluting the
 * listing with a name nobody wanted, and a comment could not exist anywhere a
 * label did not.
 *
 * A region's `comment` is deliberately *not* this. It describes a span, is a
 * property of the region object alongside its name, and is rendered in the
 * memory map rather than in the disassembly. Different thing, different home.
 */

/**
 * Where it goes relative to the row it is about.
 *
 * Placement is the only axis, and length follows from it: a `before` comment
 * owns its own rows and may run to several lines, an `inline` one shares a row
 * with an instruction and therefore cannot. Treating "long" and "short" as a
 * separate field would permit a long inline comment, which has no rendering.
 */
export type CommentPlacement = "before" | "inline";

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
}

export function createComment(
  id: string,
  address: number,
  placement: CommentPlacement,
  text: string
): Comment {
  return { id, address, placement, text };
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
    at.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.byAddress.set(comment.address, at);
  }

  addAll(comments: readonly Comment[]): void {
    for (const comment of comments) this.add(comment);
  }

  /** Comments at an address with the given placement, in stable order. */
  at(address: number, placement: CommentPlacement): readonly Comment[] {
    return (this.byAddress.get(address) ?? []).filter((c) => c.placement === placement);
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
