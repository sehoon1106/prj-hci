import { assetUrl } from '../lib/assetUrl'
import { useStudySession } from '../session/StudySessionContext'
import type { ConditionKey } from '../types/study'

const CONDITION_VARIANTS: ConditionKey[] = ['no_edit', 'ai_edited_image']

/**
 * After the first image block, preloads second-block and memory assets in the background
 * (filler / attention / …) so we do not compete with baseline downloads during the timed view.
 */
export function StudyMediaPreload() {
  const { bundle, condition, phase } = useStudySession()
  const slides = bundle.slides.slides
  const items = bundle.memory.items

  const shouldPreloadHeavy =
    condition !== null &&
    phase !== 'intro' &&
    phase !== 'demographics' &&
    phase !== 'pre_survey' &&
    phase !== 'baseline'

  return (
    <div className="visually-hidden" aria-hidden>
      {!shouldPreloadHeavy
        ? null
        : slides.flatMap((slide) =>
            (condition === 'group_mixed' ? CONDITION_VARIANTS : [condition]).map((variant) => {
              const src = assetUrl(slide.conditionSrc[variant])
              if (slide.conditionMediaType[variant] === 'video') {
                return (
                  <video
                    key={`cond-v-${slide.id}-${variant}`}
                    preload="metadata"
                    muted
                    playsInline
                    src={src}
                  />
                )
              }
              return (
                <img
                  key={`cond-i-${slide.id}-${variant}`}
                  src={src}
                  alt=""
                  decoding="async"
                  fetchPriority="low"
                />
              )
            }),
          )}
      {shouldPreloadHeavy
        ? items.map((it) => (
            <img
              key={`mem-${it.slideId}`}
              src={assetUrl(it.maskedSrc)}
              alt=""
              decoding="async"
              fetchPriority="low"
              loading="lazy"
            />
          ))
        : null}
    </div>
  )
}
