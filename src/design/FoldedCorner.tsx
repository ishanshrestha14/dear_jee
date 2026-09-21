/**
 * A dog-eared corner: the page folded back on itself at bottom-left, the way
 * you fold a corner you want to find again.
 *
 * Bottom-left is chosen for forward compatibility rather than necessity. Only
 * top-right is occupied today — the modal's close button and the card's unread
 * dot — but the unmerged letter-themes work puts ornaments at top-left and
 * bottom-right, so taking bottom-left now means the two never fight over a
 * corner.
 *
 * Must be passed through PaperTexture's `ornament` prop, never as an ordinary
 * child: as a child it would resolve against the padded content box and paint
 * over the letter's words. See the prop's own doc comment.
 *
 * Two colours, both existing palette tokens, each applied as `currentColor` on
 * its own path so no new hex value enters the file: the flap shows the page's
 * reverse (`paper-app`, a shade off the letter tone) and the crease is the
 * fold line (`paper-edge`).
 *
 * aria-hidden: the fold's meaning reaches a screen reader through the toggle
 * button's label, not through a decorative triangle announced mid-letter.
 */
export function FoldedCorner() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 28 28"
      className="pointer-events-none absolute bottom-0 left-0 h-7 w-7"
    >
      <path d="M0 0 L28 28 L0 28 Z" fill="currentColor" className="text-paper-app" />
      <path
        d="M0 0 L28 28"
        stroke="currentColor"
        strokeWidth="1"
        className="text-paper-edge"
        fill="none"
      />
    </svg>
  )
}

/**
 * The same shape at icon size, for the toggle that makes it. Sized 18 to sit
 * with the lucide icons already in the modal's action row, and stroked rather
 * than filled so it reads as an outline control rather than a filled state.
 */
export function FoldGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 18 18"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 2.5 H15.5 V15.5 H8 L2.5 10 Z" />
      <path d="M8 15.5 V10 H2.5" />
    </svg>
  )
}
