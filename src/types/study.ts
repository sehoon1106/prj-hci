export type ConditionKey =
  | 'control'
  | 'ai_edited_image'
  | 'ai_video_unedited'
  | 'ai_video_edited'

export type StudyPhase =
  | 'intro'
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
  showConditionKeyToParticipant: boolean
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
  itemIndex: number
  slideId: string
  recall: 'agree' | 'disagree' | 'unsure'
  confidence: number
}

export interface StudyBundle {
  study: StudyMeta
  filler: FillerConfig
  preSurvey: SurveyConfig
  attention2: SurveyConfig
  postSurvey: SurveyConfig
  slides: SlidesConfig
  memory: MemoryItemsConfig
}
