import { useState } from 'react'
import { Check, Link as LinkIcon } from 'lucide-react'

/**
 * The unlinked empty state's main action: a copyable /join/<code> URL to
 * send to your partner in whatever app you already text in.
 */
export function InviteLink({ inviteCode }: { inviteCode: string }) {
  const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}/join/${inviteCode}`

  async function copy() {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Dear Jee', url })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // The user dismissed the share sheet, or the clipboard was refused.
      // Nothing to recover from; the URL is on screen to copy by hand.
    }
  }

  return (
    <div className="mx-auto mt-8 max-w-sm">
      <p className="break-all rounded-letter border border-paper-edge bg-paper-app px-3 py-2 font-ui text-xs text-ink-muted">
        {url}
      </p>
      <button
        type="button"
        onClick={() => void copy()}
        className="mt-3 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2 font-ui text-sm font-medium text-paper-app transition-shadow hover:shadow-letter-lifted"
      >
        {copied ? <Check size={15} /> : <LinkIcon size={15} />}
        {copied ? 'Copied' : 'Copy invite link'}
      </button>
    </div>
  )
}
