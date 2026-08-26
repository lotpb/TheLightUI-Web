import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ONBOARDING_STEPS } from '../models/onboarding'
import {
  getOnboardingProgress, isOnboardingDismissed, dismissOnboarding,
  type OnboardingProgress,
} from '../services/onboardingService'
import { usePermissions } from '../hooks/usePermissions'

export default function OnboardingChecklist() {
  const perms = usePermissions()
  const [progress, setProgress] = useState<OnboardingProgress | null>(null)
  const [dismissed, setDismissed] = useState(true) // default hidden until we know otherwise, to avoid a flash

  useEffect(() => {
    let cancelled = false
    Promise.all([getOnboardingProgress(), isOnboardingDismissed()]).then(([p, d]) => {
      if (cancelled) return
      setProgress(p)
      setDismissed(d)
    })
    return () => { cancelled = true }
  }, [])

  if (!progress) return null

  const allDone = progress.firstRecord && progress.inviteTeam && progress.firstDocument
  if (allDone || dismissed) return null

  const doneCount = Number(progress.firstRecord) + Number(progress.inviteTeam) + Number(progress.firstDocument)

  async function handleDismiss() {
    setDismissed(true) // optimistic — don't make the user wait on a write to hide a banner
    try {
      await dismissOnboarding()
    } catch {
      setDismissed(false)
    }
  }

  return (
    <section className="card p-4 border border-indigo-700/40 bg-indigo-950/20">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-white">Getting Started</p>
          <p className="text-xs text-gray-400 mt-0.5">{doneCount} of {ONBOARDING_STEPS.length} steps complete</p>
        </div>
        {perms.canManageTeam && (
          <button
            onClick={handleDismiss}
            className="text-gray-500 hover:text-gray-300 transition-colors text-xs"
          >
            Dismiss
          </button>
        )}
      </div>
      <div className="space-y-2">
        {ONBOARDING_STEPS.map(step => {
          const done = progress[step.id]
          return (
            <div
              key={step.id}
              className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 ${done ? 'bg-green-900/15' : 'bg-gray-800/50'}`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-xs ${
                  done ? 'bg-green-600 text-white' : 'border border-gray-600 text-transparent'
                }`}>
                  ✓
                </span>
                <div className="min-w-0">
                  <p className={`text-sm truncate ${done ? 'text-gray-400 line-through' : 'text-gray-200 font-medium'}`}>
                    {step.label}
                  </p>
                  {!done && <p className="text-xs text-gray-500 truncate">{step.description}</p>}
                </div>
              </div>
              {!done && (
                <Link to={step.to} className="text-xs text-indigo-400 hover:text-indigo-300 shrink-0 whitespace-nowrap">
                  {step.linkLabel} →
                </Link>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
