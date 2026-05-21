import type { ConditionKey } from '../types/study'
import { GROUP_PARTICIPANT_IDS, type GroupParticipantId } from './groupSync'

export { GROUP_PARTICIPANT_IDS, type GroupParticipantId }

export const GROUP_MIXED_SESSION_CONDITION = 'group_mixed' as const
export type GroupMixedSessionCondition = typeof GROUP_MIXED_SESSION_CONDITION

/** All ways to choose which two participants see original (`no_edit`) on one slide. */
const NO_EDIT_PAIRS: [GroupParticipantId, GroupParticipantId][] = [
  ['P1', 'P2'],
  ['P1', 'P3'],
  ['P1', 'P4'],
  ['P2', 'P3'],
  ['P2', 'P4'],
  ['P3', 'P4'],
]

function stableHash(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function createDeterministicOrder(size: number, seedText: string): number[] {
  const out = Array.from({ length: size }, (_, i) => i)
  let seed = stableHash(seedText) || 1
  for (let i = out.length - 1; i > 0; i -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const j = seed % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Per-slide shuffle of the six 2-person original pairs (seeded by group + slideId). */
function pairTryOrderForSlide(groupId: string, slideId: string): number[] {
  return createDeterministicOrder(6, `group-condition-slide:${groupId}:${slideId}`)
}

export interface GroupSlideConditionExposure {
  slideId: string
  configSlideIndex: number
  noEditParticipants: GroupParticipantId[]
  aiEditedParticipants: GroupParticipantId[]
}

export interface GroupConditionAssignmentPlan {
  /** Per participant: slideId → condition viewed in the second image set. */
  byParticipant: Record<GroupParticipantId, Record<string, ConditionKey>>
  /** One row per slide (config order); stable for analysis joins on `slideId`. */
  exposureTable: GroupSlideConditionExposure[]
  /** Counts for this participant (sanity / logging). */
  participantSummary: Record<
    GroupParticipantId,
    { no_edit: number; ai_edited_image: number; slideCount: number }
  >
}

function emptyCounts(): Record<ConditionKey, number> {
  return { no_edit: 0, ai_edited_image: 0 }
}

function pairFitsBalance(
  pair: [GroupParticipantId, GroupParticipantId],
  counts: Record<GroupParticipantId, Record<ConditionKey, number>>,
  slideCount: number,
): boolean {
  const maxPerCondition = Math.ceil(slideCount / 2)
  return GROUP_PARTICIPANT_IDS.every((member) => {
    const next: ConditionKey = pair.includes(member) ? 'no_edit' : 'ai_edited_image'
    const nextNo = counts[member].no_edit + (next === 'no_edit' ? 1 : 0)
    const nextAi = counts[member].ai_edited_image + (next === 'ai_edited_image' ? 1 : 0)
    return (
      nextNo <= maxPerCondition &&
      nextAi <= maxPerCondition &&
      nextNo >= 0 &&
      nextAi >= 0
    )
  })
}

function pickPairForSlide(
  tryOrder: number[],
  counts: Record<GroupParticipantId, Record<ConditionKey, number>>,
  slideCount: number,
): [GroupParticipantId, GroupParticipantId] | null {
  for (const pairIndex of tryOrder) {
    const pair = NO_EDIT_PAIRS[pairIndex]!
    if (pairFitsBalance(pair, counts, slideCount)) return pair
  }
  for (let pairIndex = 0; pairIndex < NO_EDIT_PAIRS.length; pairIndex += 1) {
    const pair = NO_EDIT_PAIRS[pairIndex]!
    if (pairFitsBalance(pair, counts, slideCount)) return pair
  }
  return null
}

function applyPairToSlide(
  pickedPair: [GroupParticipantId, GroupParticipantId],
  slide: { id: string },
  slideIdx: number,
  counts: Record<GroupParticipantId, Record<ConditionKey, number>>,
  byParticipant: Record<GroupParticipantId, Record<string, ConditionKey>>,
  exposureTable: GroupSlideConditionExposure[],
): void {
  const noEditParticipants: GroupParticipantId[] = [...pickedPair]
  const aiEditedParticipants = GROUP_PARTICIPANT_IDS.filter((m) => !pickedPair.includes(m))

  for (const member of GROUP_PARTICIPANT_IDS) {
    const key: ConditionKey = pickedPair.includes(member) ? 'no_edit' : 'ai_edited_image'
    byParticipant[member][slide.id] = key
    counts[member][key] += 1
  }

  exposureTable.push({
    slideId: slide.id,
    configSlideIndex: slideIdx,
    noEditParticipants,
    aiEditedParticipants,
  })
}

/**
 * Balanced group design: for every slide, exactly two participants see original and two see
 * AI-edited; each participant sees ~half of slides as each version.
 * Who gets original is shuffled **per slide** (deterministic from `groupId` + `slideId`).
 */
export function buildGroupConditionAssignmentPlan(
  groupId: string,
  slides: { id: string }[],
): GroupConditionAssignmentPlan {
  const normalizedGroupId = groupId.trim().toLowerCase()
  const slideCount = slides.length
  const minPerCondition = Math.floor(slideCount / 2)
  const maxPerCondition = Math.ceil(slideCount / 2)

  const counts: Record<GroupParticipantId, Record<ConditionKey, number>> = {
    P1: emptyCounts(),
    P2: emptyCounts(),
    P3: emptyCounts(),
    P4: emptyCounts(),
  }

  const byParticipant: Record<GroupParticipantId, Record<string, ConditionKey>> = {
    P1: {},
    P2: {},
    P3: {},
    P4: {},
  }

  const exposureTable: GroupSlideConditionExposure[] = []

  for (let slideIdx = 0; slideIdx < slideCount; slideIdx += 1) {
    const slide = slides[slideIdx]!
    const tryOrder = pairTryOrderForSlide(normalizedGroupId, slide.id)
    const pickedPair = pickPairForSlide(tryOrder, counts, slideCount)
    if (!pickedPair) {
      throw new Error(
        `Could not assign condition pair for slide ${slide.id} (groupId=${normalizedGroupId}).`,
      )
    }

    applyPairToSlide(pickedPair, slide, slideIdx, counts, byParticipant, exposureTable)
  }

  const participantSummary = Object.fromEntries(
    GROUP_PARTICIPANT_IDS.map((member) => {
      const no = counts[member].no_edit
      const ai = counts[member].ai_edited_image
      if (
        no + ai !== slideCount ||
        no < minPerCondition ||
        no > maxPerCondition ||
        ai < minPerCondition ||
        ai > maxPerCondition
      ) {
        throw new Error(
          `Unbalanced assignment for ${member} in group ${normalizedGroupId}: no_edit=${no}, ai=${ai}, slides=${slideCount}`,
        )
      }
      return [
        member,
        {
          no_edit: no,
          ai_edited_image: ai,
          slideCount,
        },
      ]
    }),
  ) as GroupConditionAssignmentPlan['participantSummary']

  return { byParticipant, exposureTable, participantSummary }
}

export function conditionViewedForParticipant(
  plan: GroupConditionAssignmentPlan,
  anonId: GroupParticipantId,
  slideId: string,
): ConditionKey | undefined {
  return plan.byParticipant[anonId][slideId]
}

/** Stored on `discussion_messages.condition_exposure` for each question row. */
export function conditionExposureForSlide(
  exposureTable: GroupSlideConditionExposure[],
  slideId: string,
): GroupSlideConditionExposure | undefined {
  return exposureTable.find((row) => row.slideId === slideId)
}
