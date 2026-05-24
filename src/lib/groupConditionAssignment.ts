import type { ConditionKey, EditType, ImageType, SlideDef } from '../types/study'
import { GROUP_PARTICIPANT_IDS, type GroupParticipantId } from './groupSync'

export { GROUP_PARTICIPANT_IDS, type GroupParticipantId }

export const GROUP_MIXED_SESSION_CONDITION = 'group_mixed' as const
export type GroupMixedSessionCondition = typeof GROUP_MIXED_SESSION_CONDITION

type Scheme = 'A' | 'B' | 'C' | 'D'

/**
 * Each participant in a group of 4 is mapped to one of four schemes. The schemes are designed
 * so that across the four participants, every slide is shown as original to exactly 2 and as
 * AI-edited to exactly 2 — while every participant sees, within each image type, exactly
 * 2 originals + 1 congruent edit + 1 incongruent edit.
 */
const PARTICIPANT_SCHEMES: Record<GroupParticipantId, Scheme> = {
  P1: 'A',
  P2: 'B',
  P3: 'C',
  P4: 'D',
}

/**
 * Within one image type, slides split into 2 congruent + 2 incongruent (config order: 1st, 2nd).
 * For each scheme, exactly one congruent slot and one incongruent slot are shown edited; the
 * other two are shown original. Across {A,B,C,D} every slot is edited twice and original twice.
 */
const SCHEME_EDIT_INDEX: Record<Scheme, { congruent: 0 | 1; incongruent: 0 | 1 }> = {
  A: { congruent: 0, incongruent: 0 },
  B: { congruent: 0, incongruent: 1 },
  C: { congruent: 1, incongruent: 0 },
  D: { congruent: 1, incongruent: 1 },
}

const IMAGE_TYPES: ImageType[] = ['env', 'object', 'people']

export interface GroupSlideConditionExposure {
  slideId: string
  configSlideIndex: number
  imageType: ImageType
  editType: EditType
  noEditParticipants: GroupParticipantId[]
  aiEditedParticipants: GroupParticipantId[]
}

export interface GroupParticipantSummary {
  no_edit: number
  ai_edited_image: number
  congruent_edited: number
  incongruent_edited: number
  slideCount: number
  scheme: Scheme
}

export interface GroupConditionAssignmentPlan {
  byParticipant: Record<GroupParticipantId, Record<string, ConditionKey>>
  exposureTable: GroupSlideConditionExposure[]
  participantSummary: Record<GroupParticipantId, GroupParticipantSummary>
}

interface SlideMeta {
  id: string
  configIndex: number
  imageType: ImageType
  editType: EditType
}

function validateAndIndex(slides: SlideDef[]): {
  byTypeCongruent: Record<ImageType, SlideMeta[]>
  byTypeIncongruent: Record<ImageType, SlideMeta[]>
  metas: SlideMeta[]
} {
  const byTypeCongruent: Record<ImageType, SlideMeta[]> = { env: [], object: [], people: [] }
  const byTypeIncongruent: Record<ImageType, SlideMeta[]> = { env: [], object: [], people: [] }
  const metas: SlideMeta[] = slides.map((s, i) => ({
    id: s.id,
    configIndex: i,
    imageType: s.imageType,
    editType: s.editType,
  }))
  for (const m of metas) {
    const bucket = m.editType === 'congruent' ? byTypeCongruent : byTypeIncongruent
    bucket[m.imageType].push(m)
  }
  for (const t of IMAGE_TYPES) {
    if (byTypeCongruent[t].length !== 2 || byTypeIncongruent[t].length !== 2) {
      throw new Error(
        `Image type "${t}" must have exactly 2 congruent + 2 incongruent slides; got ` +
          `congruent=${byTypeCongruent[t].length}, incongruent=${byTypeIncongruent[t].length}`,
      )
    }
  }
  return { byTypeCongruent, byTypeIncongruent, metas }
}

/**
 * Deterministic 2-original / 1-congruent-edit / 1-incongruent-edit assignment per participant,
 * within every image type. groupId is accepted for API compatibility but is no longer used —
 * assignment depends only on the slide config and participant ID.
 */
export function buildGroupConditionAssignmentPlan(
  _groupId: string,
  slides: SlideDef[],
): GroupConditionAssignmentPlan {
  const { byTypeCongruent, byTypeIncongruent, metas } = validateAndIndex(slides)

  const byParticipant: Record<GroupParticipantId, Record<string, ConditionKey>> = {
    P1: {},
    P2: {},
    P3: {},
    P4: {},
  }

  for (const participant of GROUP_PARTICIPANT_IDS) {
    const scheme = PARTICIPANT_SCHEMES[participant]
    const idx = SCHEME_EDIT_INDEX[scheme]
    for (const t of IMAGE_TYPES) {
      const cong = byTypeCongruent[t]
      const incong = byTypeIncongruent[t]
      cong.forEach((slide, i) => {
        byParticipant[participant][slide.id] = i === idx.congruent ? 'ai_edited_image' : 'no_edit'
      })
      incong.forEach((slide, i) => {
        byParticipant[participant][slide.id] = i === idx.incongruent ? 'ai_edited_image' : 'no_edit'
      })
    }
  }

  const exposureTable: GroupSlideConditionExposure[] = metas.map((m) => {
    const noEditParticipants: GroupParticipantId[] = []
    const aiEditedParticipants: GroupParticipantId[] = []
    for (const p of GROUP_PARTICIPANT_IDS) {
      if (byParticipant[p][m.id] === 'no_edit') noEditParticipants.push(p)
      else aiEditedParticipants.push(p)
    }
    return {
      slideId: m.id,
      configSlideIndex: m.configIndex,
      imageType: m.imageType,
      editType: m.editType,
      noEditParticipants,
      aiEditedParticipants,
    }
  })

  const participantSummary = Object.fromEntries(
    GROUP_PARTICIPANT_IDS.map((p) => {
      let no = 0
      let ai = 0
      let cong = 0
      let incong = 0
      for (const m of metas) {
        const k = byParticipant[p][m.id]
        if (k === 'no_edit') {
          no += 1
        } else {
          ai += 1
          if (m.editType === 'congruent') cong += 1
          else incong += 1
        }
      }
      const expectedCong = IMAGE_TYPES.length
      const expectedIncong = IMAGE_TYPES.length
      const expectedNo = IMAGE_TYPES.length * 2
      if (no !== expectedNo || cong !== expectedCong || incong !== expectedIncong) {
        throw new Error(
          `Unbalanced assignment for ${p}: no_edit=${no} (want ${expectedNo}), ` +
            `congruent_edited=${cong} (want ${expectedCong}), incongruent_edited=${incong} (want ${expectedIncong})`,
        )
      }
      const summary: GroupParticipantSummary = {
        no_edit: no,
        ai_edited_image: ai,
        congruent_edited: cong,
        incongruent_edited: incong,
        slideCount: metas.length,
        scheme: PARTICIPANT_SCHEMES[p],
      }
      return [p, summary]
    }),
  ) as Record<GroupParticipantId, GroupParticipantSummary>

  for (const row of exposureTable) {
    if (row.noEditParticipants.length !== 2 || row.aiEditedParticipants.length !== 2) {
      throw new Error(
        `Slide ${row.slideId} not balanced 2/2: noEdit=${row.noEditParticipants.length}, ` +
          `aiEdited=${row.aiEditedParticipants.length}`,
      )
    }
  }

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
