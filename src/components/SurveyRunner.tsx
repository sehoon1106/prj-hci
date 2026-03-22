import { useState, type FormEvent } from 'react'
import type { SurveyConfig, SurveyItem } from '../types/study'

function renderItem(
  item: SurveyItem,
  value: string | number | undefined,
  onChange: (v: string | number) => void,
) {
  const name = item.id
  switch (item.type) {
    case 'attention_mc':
    case 'single_choice':
      return (
        <fieldset className="survey-fieldset">
          <legend className="survey-prompt">{item.prompt}</legend>
          <div className="survey-options">
            {item.options.map((o) => (
              <label key={o.value} className="survey-option">
                <input
                  type="radio"
                  name={name}
                  value={o.value}
                  checked={value === o.value}
                  onChange={() => onChange(o.value)}
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )
    case 'likert7': {
      const nums = [1, 2, 3, 4, 5, 6, 7]
      return (
        <fieldset className="survey-fieldset">
          <legend className="survey-prompt">{item.prompt}</legend>
          <p className="likert-labels">
            <span>{item.labels.min}</span>
            <span>{item.labels.max}</span>
          </p>
          <div className="likert-row">
            {nums.map((n) => (
              <label key={n} className="likert-cell">
                <input
                  type="radio"
                  name={name}
                  value={String(n)}
                  checked={value === n}
                  onChange={() => onChange(n)}
                />
                <span>{n}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )
    }
    case 'text':
      return (
        <label className="survey-block">
          <span className="survey-prompt">{item.prompt}</span>
          <input
            type="text"
            className="survey-input"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      )
    case 'number':
      return (
        <label className="survey-block">
          <span className="survey-prompt">{item.prompt}</span>
          <input
            type="number"
            className="survey-input narrow"
            min={item.min}
            max={item.max}
            value={value === undefined || value === '' ? '' : value}
            onChange={(e) =>
              onChange(e.target.value === '' ? '' : Number(e.target.value))
            }
          />
        </label>
      )
    default:
      return null
  }
}

function validatePage(
  items: SurveyItem[],
  answers: Record<string, string | number>,
): string | null {
  for (const item of items) {
    const v = answers[item.id]
    if (item.type === 'attention_mc') {
      if (v === undefined || v === '') return 'Please answer all items on this page.'
      if (v !== item.correctValue)
        return 'The attention-check answer is incorrect. Please read the instructions again.'
    } else if (item.required !== false) {
      if (v === undefined || v === '') return 'Please answer all required items.'
    }
  }
  return null
}

export function SurveyRunner({
  config,
  answers,
  onChange,
  onComplete,
  logSurveyId,
  onLog,
  onDebugSkipEntireSurvey,
}: {
  config: SurveyConfig
  answers: Record<string, string | number>
  onChange: (answers: Record<string, string | number>) => void
  onComplete: () => void
  logSurveyId: string
  onLog?: (type: string, payload?: Record<string, unknown>) => void
  /** Debug: mark entire survey complete without validation and go to next phase */
  onDebugSkipEntireSurvey?: () => void
}) {
  const [pageIdx, setPageIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const page = config.pages[pageIdx]

  const setField = (id: string, v: string | number) => {
    onChange({ ...answers, [id]: v })
  }

  const handleNext = (e: FormEvent) => {
    e.preventDefault()
    const err = validatePage(page.items, answers)
    if (err) {
      setError(err)
      onLog?.('survey_validation_fail', {
        surveyId: logSurveyId,
        pageId: page.id,
        message: err,
      })
      return
    }
    setError(null)
    onLog?.('survey_page_done', { surveyId: logSurveyId, pageId: page.id })
    if (pageIdx + 1 >= config.pages.length) onComplete()
    else setPageIdx((i) => i + 1)
  }

  const handleBack = () => {
    setError(null)
    if (pageIdx > 0) setPageIdx((i) => i - 1)
  }

  return (
    <form className="card survey-form" onSubmit={handleNext}>
      <header className="card-header">
        <p className="eyebrow">
          {config.title} · {pageIdx + 1} / {config.pages.length}
        </p>
        <h2>{page.title}</h2>
        {page.description ? <p className="muted">{page.description}</p> : null}
      </header>
      {onDebugSkipEntireSurvey ? (
        <div className="debug-skip-bar">
          <button
            type="button"
            className="btn debug-skip"
            onClick={() => {
              onLog?.('survey_debug_skip_entire', {
                surveyId: logSurveyId,
                pageId: page.id,
                pageIndex: pageIdx,
              })
              onDebugSkipEntireSurvey()
            }}
          >
            [Debug] Skip entire survey (next phase without validation)
          </button>
        </div>
      ) : null}
      <div className="survey-items">
        {page.items.map((item) => (
          <div key={item.id} className="survey-item-wrap">
            {renderItem(item, answers[item.id], (v) => setField(item.id, v))}
          </div>
        ))}
      </div>
      {error ? <p className="error-banner">{error}</p> : null}
      <div className="btn-row">
        {pageIdx > 0 ? (
          <button type="button" className="btn secondary" onClick={handleBack}>
            Back
          </button>
        ) : (
          <span />
        )}
        <button type="submit" className="btn primary">
          {pageIdx + 1 >= config.pages.length ? 'Done' : 'Next'}
        </button>
      </div>
    </form>
  )
}
