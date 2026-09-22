import { ICONS as APP_ICONS } from './Icon'

export const ICONS = APP_ICONS

/**
 * An icon for the customer-facing pages.
 *
 * Those five pages carried 🔒 📞 ✉ 📍 ✅ 🛠 ✓ 📄 ⏳ 💳 💰 🖨️ 🎉 as their only
 * iconography — and on the portal's contact rows the emoji was the field's
 * *only* label, so a screen reader announced "telephone emoji, 555-0100" or
 * nothing at all. Emoji also render from Apple Color Emoji and ignore `color`,
 * so they never matched the text beside them.
 *
 * Paths come from components/Icon so there's one source. This wrapper exists
 * because that component takes Tailwind classes, and these pages are
 * deliberately inline-styled so they inherit nothing from the app theme.
 *
 * `title` makes it an img with a name; without one it's aria-hidden, which is
 * right whenever adjacent text already says what it means.
 */
export function PublicGlyph({
  d, size = 16, color = 'currentColor', title, style,
}: {
  d: string | readonly string[]
  size?: number
  color?: string
  title?: string
  style?: React.CSSProperties
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: '0 0 auto', ...style }}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {(Array.isArray(d) ? d : [d as string]).map((p, i) => <path key={i} d={p} />)}
    </svg>
  )
}
