import { BODY_FONTS, type BodyFont } from '../lib/validation'

/**
 * The CSS font-family for a letter's chosen face. Null — an older letter, or
 * one whose writer did not choose — gets Lora, which is what every letter
 * looked like before the choice existed.
 */
export function fontStack(bodyFont: BodyFont | null): string {
  const id = bodyFont ?? 'lora'
  return BODY_FONTS.find((f) => f.id === id)?.stack ?? BODY_FONTS[0].stack
}

/**
 * Loads a letter's face on demand.
 *
 * Lora, Caveat and Plus Jakarta Sans ship eagerly from src/design/fonts.ts
 * because the app chrome uses them. The other three are imported only when a
 * letter actually calls for one — a stranger opening a Lora letter downloads
 * nothing extra, and one opening a Courier Prime letter downloads one family.
 *
 * This is what preserves the work that got a stranger's first load of a shared
 * letter to 133 kB gzipped. Declaring all six eagerly would put three more
 * families of @font-face subset declarations on the public route's critical
 * path for a face most letters will not use.
 *
 * Failure is deliberately silent: the fallback in every stack is a real serif,
 * so a letter whose face fails to load is still perfectly readable, and an
 * error banner about a font would be worse than the substitution.
 */
export async function loadLetterFont(bodyFont: BodyFont | null): Promise<void> {
  try {
    switch (bodyFont) {
      case 'eb-garamond':
        await import('@fontsource/eb-garamond/400.css')
        return
      case 'courier-prime':
        await import('@fontsource/courier-prime/400.css')
        return
      case 'dancing-script':
        await import('@fontsource/dancing-script/400.css')
        return
      // 'lora', 'caveat' and null need nothing — already loaded eagerly.
      default:
        return
    }
  } catch {
    // See the note above: the fallback stack carries it.
  }
}
