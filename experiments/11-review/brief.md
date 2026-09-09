# Resolve, fill, and sharpen — on a project three sessions have already worked on

You are working on a document **somebody else has already worked on**: three
earlier sessions, nine people between them, about four hours in total. A person
is watching, and the document is live.

The program is past its decruncher. Pass `target: "runtime"` for everything
unless you mean something else; the other targets are the packed file, the
machine with its ROMs, and two builds of the program that differ from each other.

## Three things

In whatever order the program suggests. They will turn out to be the same work
seen from three sides more often than you expect.

**1. Resolve conflicts.** They did not always agree with each other, and nobody
has ever gone back over it. Two people naming one address differently. Two
readings of the same bytes. A claim written before another was made that would
have changed it. Where you can tell who is right, decide — and record the
decision so a reader meets one clear answer without the earlier reading being
swept away. Somebody's wrong turn is how they got where they got.

**2. Fill gaps.** There are spans nothing has said anything about, and there are
things named but not explained. Both are gaps.

**3. Sharpen claims that are too broad.** This is the least obvious and possibly
the most valuable. **A claim can be true and tell a reader nothing.** "These
8,400 bytes are data" is not wrong; it is also not an explanation. If a span has
a shape — records, fields at fixed offsets, a table of something, a header — then
saying so is strictly better than saying it is bytes. Look at the largest claims
first: size is a good proxy for vagueness.

## The point of all three

**A disassembly is for reading.** Everything here was written to establish what
the bytes *are*; nobody has yet asked whether somebody who has never seen this
program could open the listing and follow it. That is the standard to hold each
of the three against — not tidiness, and not consistency.

## Depth, not breadth — and the churn rule

Sweeping all 47K is not the task and would not be an improvement. Prefer a
handful of things understood properly to a hundred touched.

**A change that teaches a reader nothing is churn.** Renaming to match a
convention, rewording a comment that was already clear, tidying for its own sake:
these look like work and are not. The rule, and it is a hard one:

> If you rename or rewrite something, be able to say **what a reader could not
> tell before and can now**. If you cannot, leave it alone.

You will find inconsistency — different naming styles, comments of wildly
different lengths, two conventions for one thing. Most of it is not worth
touching. Some of it actively misleads. Only the second kind is your business.

## How to work

- **Read before you write.** Roughly a thousand things are already here, and some
  of them are very good. Some were written before parts of this tool existed.
- Where you think something is simply wrong, **say so** rather than deleting it
  and moving on. A reader who meets a correction learns more than one who meets a
  tidy page.
- When you are about to do something the tools make awkward, **write down what it
  was** — as it happens, not from memory afterwards. Anything you compute by hand
  more than twice is a finding.
- Do not read the rest of this repository. Everything you need is reachable
  through the tools.

## What to leave behind

The project itself is the deliverable. A finding that lives only in your notes
did not happen.

Then a short `findings.md` in your working directory:

- **What you resolved**, and how you decided.
- **What you sharpened**, and what the broad claim had been hiding.
- **What you filled**, and what is still empty.
- **What you could not record in the project, and what you did instead.** With
  counts. This is the most valuable thing you can write.
- **What you would want that does not exist.** Name it plainly.

Do not pad it. Six honest paragraphs beat four pages.
