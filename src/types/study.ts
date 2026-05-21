export type ConditionKey = 'no_edit' | 'ai_edited_image'

/** Stored on `study_submissions.condition_key` for group sessions with per-slide assignment. */
export type GroupSessionConditionKey = 'group_mixed'

export type StudyPhase =
  | 'intro'
  | 'group_lobby'
  | 'demographics'
  | 'pre_survey'
  | 'baseline'
  | 'filler'
  | 'attention2'
  | 'condition'
  | 'memory'
  | 'post_survey'
  | 'complete'

export type SurveyItemType =
  | 'attention_mc'
  | 'likert7'
  | 'text'
  | 'number'
  | 'single_choice'

export interface SurveyOption {
  value: string
  label: string
}

export interface SurveyItemBase {
  id: string
  prompt: string
  required?: boolean
}

export interface AttentionMcItem extends SurveyItemBase {
  type: 'attention_mc'
  options: SurveyOption[]
  correctValue: string
}

export interface Likert7Item extends SurveyItemBase {
  type: 'likert7'
  labels: { min: string; max: string }
}

export interface TextItem extends SurveyItemBase {
  type: 'text'
}

export interface NumberItem extends SurveyItemBase {
  type: 'number'
  min?: number
  max?: number
}

export interface SingleChoiceItem extends SurveyItemBase {
  type: 'single_choice'
  options: SurveyOption[]
}

export type SurveyItem =
  | AttentionMcItem
  | Likert7Item
  | TextItem
  | NumberItem
  | SingleChoiceItem

export interface SurveyPage {
  id: string
  title: string
  description?: string
  items: SurveyItem[]
}

export interface SurveyConfig {
  schemaVersion: number
  id: string
  title: string
  pages: SurveyPage[]
}

export interface SlideDef {
  id: string
  baselineSrc: string
  conditionSrc: Record<ConditionKey, string>
  conditionMediaType: Record<ConditionKey, 'image' | 'video'>
}

export interface SlidesConfig {
  schemaVersion: number
  slides: SlideDef[]
}

export interface MemoryItemDef {
  slideId: string
  maskedSrc: string
  prompt: string
  /** For analysis: e.g. whether "agree" is correct vs original — may be omitted in placeholders */
  expectedAnswer?: 'agree' | 'disagree'
  analysisNote?: string
}

export interface MemoryItemsConfig {
  schemaVersion: number
  items: MemoryItemDef[]
}

export interface StudyMeta {
  schemaVersion: number
  title: string
  shortDescription: string
  /** Shown on the consent page as a short bulleted overview (English copy lives in study.json). */
  procedureSteps?: string[]
  consentText: string
  baselinePhaseTitle: string
  baselinePhaseInstructions: string
  conditionPhaseTitle: string
  conditionPhaseInstructions: string
  memoryPhaseTitle: string
  memoryPhaseInstructions: string
  randomizeCondition: boolean
  conditionKeys: ConditionKey[]
  conditionLabels: Record<ConditionKey, string>
  baselineDurationSeconds: number
  /** Minimum seconds on the second (condition) image set before auto-advance */
  conditionDurationSeconds: number
  showConditionKeyToParticipant: boolean
  /**
   * If set, the post-study step shows this link (e.g. Google Form) instead of `post-survey.json`.
   * Submitted `postSurvey` in the payload stays empty unless the in-app survey is used.
   */
  postStudyExternalFormUrl?: string
  /**
   * Per session: shuffle presentation order for each phase independently.
   * Indices in `slides.json` / `memory-items.json` and `slideId` stay stable; event logs and
   * `MemoryResponse.itemIndex` refer to config order, not screen order.
   */
  randomizeBaselineSlideOrder?: boolean
  randomizeConditionSlideOrder?: boolean
  randomizeMemoryItemOrder?: boolean
  groupDiscussion?: {
    enabled: boolean
    groupSize: number
    discussionDurationSeconds: number
  }
}

/** `baseline` / `condition`: presentation index → slide index in `slides.json`. `memory` → item index in `memory-items.json`. */
export interface PresentationOrders {
  baseline: number[]
  condition: number[]
  memory: number[]
}

export interface FillerConfig {
  schemaVersion: number
  type: string
  durationSeconds: number
  minDurationSeconds: number
  title: string
  instructions: string
}

export interface LogEvent {
  t: string
  type: string
  payload?: Record<string, unknown>
}

export interface MemoryResponse {
  /** Index in original `memory-items.json` / `bundle.memory.items` (not screen order). */
  itemIndex: number
  /** Index in the randomized memory-test sequence (0…n−1). */
  presentationIndex: number
  slideId: string
  recall: 'agree' | 'disagree' | 'unsure'
  confidence: number
  /**
   * Group sessions: first individual pass vs. post-discussion responses. Omitted in individual-only runs.
   * Both rounds use the same `presentationIndex` / `itemIndex` semantics (15 trials each, stored as separate entries in `memory_responses`).
   */
  memoryRound?: 'pre_discussion' | 'post_discussion'
  /**
   * Second image set: which version this participant viewed for this slide (`slideId`).
   * Group mode only; omitted in individual between-subjects runs.
   */
  conditionViewed?: ConditionKey
  /** Ground-truth key from `memory-items.json`, if present. */
  expectedAnswer?: 'agree' | 'disagree'
  /**
   * `true` if participant choice matches `expectedAnswer`.
   * `null` if there is no key, or recall was "unsure" (no binary score).
   */
  isCorrect: boolean | null
}

export interface DiscussionMessage {
  questionIndex: number
  slideId: string
  anonId: string
  participantId?: string
  message: string
  sentAt: string
}

export function memoryTrialCorrectness(
  recall: 'agree' | 'disagree' | 'unsure',
  expectedAnswer: 'agree' | 'disagree' | undefined,
): boolean | null {
  if (expectedAnswer === undefined) return null
  if (recall === 'unsure') return null
  return recall === expectedAnswer
}

export interface StudyBundle {
  study: StudyMeta
  filler: FillerConfig
  demographics: SurveyConfig
  preSurvey: SurveyConfig
  attention2: SurveyConfig
  postSurvey: SurveyConfig
  slides: SlidesConfig
  memory: MemoryItemsConfig
}
