import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { getSupabaseClient } from '../lib/supabaseClient'
import {
  hasGroupQuorum,
  presenceLatestMetas,
  presenceReadyParticipantIds,
  scheduleBroadcastRetries,
  uniqueGroupParticipantIds,
  type GroupParticipantId,
} from '../lib/groupSync'

/**
 * Shared 4-person "press ready / start" sync: stable channel subscription, latest presence meta,
 * optimistic local ready, broadcast retries, quorum callback via ref (safe with inline onStart).
 */
export function useGroupPresenceReadyGate({
  groupId,
  anonId,
  groupSize,
  channelName,
  presenceKey,
  broadcastEvent,
  getBroadcastPayload,
  getInitialTrackPayload,
  getReadyTrackPayload,
  onQuorum,
  canFireQuorum,
  onPresenceMetas,
  leaveChannelOnUnmount = false,
}: {
  groupId: string
  anonId: GroupParticipantId
  groupSize: number
  channelName: string
  presenceKey: string
  broadcastEvent: string
  getBroadcastPayload: () => Record<string, unknown>
  getInitialTrackPayload: (localReady: boolean) => Record<string, unknown>
  getReadyTrackPayload: () => Record<string, unknown>
  onQuorum: () => void
  canFireQuorum?: (readyIds: GroupParticipantId[]) => boolean
  onPresenceMetas?: (metas: Record<string, unknown>[]) => void
  leaveChannelOnUnmount?: boolean
}) {
  const [ready, setReady] = useState(false)
  const [readyIds, setReadyIds] = useState<GroupParticipantId[]>([])
  const channelRef = useRef<RealtimeChannel | null>(null)
  const firedRef = useRef(false)
  const localReadyRef = useRef(false)
  const onQuorumRef = useRef(onQuorum)
  onQuorumRef.current = onQuorum
  const canFireQuorumRef = useRef(canFireQuorum)
  canFireQuorumRef.current = canFireQuorum
  const onPresenceMetasRef = useRef(onPresenceMetas)
  onPresenceMetasRef.current = onPresenceMetas
  const getBroadcastPayloadRef = useRef(getBroadcastPayload)
  getBroadcastPayloadRef.current = getBroadcastPayload
  const getInitialTrackPayloadRef = useRef(getInitialTrackPayload)
  getInitialTrackPayloadRef.current = getInitialTrackPayload
  const getReadyTrackPayloadRef = useRef(getReadyTrackPayload)
  getReadyTrackPayloadRef.current = getReadyTrackPayload

  const syncPresence = useCallback(
    (channel: RealtimeChannel) => {
      const presence = channel.presenceState<Record<string, unknown[] | unknown>>()
      const latest = presenceLatestMetas(presence)
      onPresenceMetasRef.current?.(latest)
      const uniqueReady = presenceReadyParticipantIds(presence)
      setReadyIds(uniqueReady)
      const canFire = canFireQuorumRef.current ? canFireQuorumRef.current(uniqueReady) : true
      if (firedRef.current || !canFire || !hasGroupQuorum(uniqueReady, groupSize)) return
      firedRef.current = true
      scheduleBroadcastRetries(() => {
        void channel.send({
          type: 'broadcast',
          event: broadcastEvent,
          payload: getBroadcastPayloadRef.current(),
        })
      })
      onQuorumRef.current()
    },
    [broadcastEvent, groupSize],
  )

  useEffect(() => {
    const client = getSupabaseClient()
    if (!client || !groupId.trim()) return

    const channel = client.channel(channelName, {
      config: { presence: { key: presenceKey } },
    })
    channelRef.current = channel

    const triggerFromBroadcast = () => {
      if (firedRef.current) return
      firedRef.current = true
      onQuorumRef.current()
    }

    const sync = () => syncPresence(channel)

    const leaveChannel = () => {
      void channel.untrack()
      void client.removeChannel(channel)
    }

    channel
      .on('broadcast', { event: broadcastEvent }, triggerFromBroadcast)
      .on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track(getInitialTrackPayloadRef.current(localReadyRef.current))
          sync()
        }
      })

    if (leaveChannelOnUnmount) {
      window.addEventListener('pagehide', leaveChannel)
      window.addEventListener('beforeunload', leaveChannel)
    }

    return () => {
      if (leaveChannelOnUnmount) {
        window.removeEventListener('pagehide', leaveChannel)
        window.removeEventListener('beforeunload', leaveChannel)
        leaveChannel()
      } else {
        void channel.untrack()
        void client.removeChannel(channel)
      }
    }
  }, [
    anonId,
    broadcastEvent,
    channelName,
    groupId,
    groupSize,
    leaveChannelOnUnmount,
    presenceKey,
    syncPresence,
  ])

  const markReady = async () => {
    if (localReadyRef.current) return
    localReadyRef.current = true
    setReady(true)
    setReadyIds((prev) => uniqueGroupParticipantIds([...prev, anonId]))
    const channel = channelRef.current
    if (!channel) return
    await channel.track(getReadyTrackPayloadRef.current())
    syncPresence(channel)
  }

  return { ready, readyIds, markReady }
}
