import { useStudySession } from '../session/StudySessionContext'

/**
 * Preloads assigned-condition stimuli (images/videos) and memory-test mask images in the DOM
 * so the browser cache warms up and the first paint is faster when those steps start.
 */
export function StudyMediaPreload() {
  const { bundle, condition } = useStudySession()
  const slides = bundle.slides.slides
  const items = bundle.memory.items

  return (
    <div className="visually-hidden" aria-hidden>
      {slides.map((slide) => {
        const src = slide.conditionSrc[condition]
        if (slide.conditionMediaType[condition] === 'video') {
          return (
            <video
              key={`cond-v-${slide.id}`}
              preload="auto"
              muted
              playsInline
              src={src}
            />
          )
        }
        return (
          <img
            key={`cond-i-${slide.id}`}
            src={src}
            alt=""
            decoding="async"
            fetchPriority="low"
          />
        )
      })}
      {items.map((it) => (
        <img
          key={`mem-${it.slideId}`}
          src={it.maskedSrc}
          alt=""
          decoding="async"
          fetchPriority="low"
        />
      ))}
    </div>
  )
}
