declare module 'react-pacman' {
  import type { ComponentType } from 'react'

  export interface ReactPacmanProps {
    /** Pixel size of one grid cell; library defaults to 12 if omitted (see npm readme). */
    gridSize?: number
    /** Called when the player loses all lives; we omit this so the filler always runs for the full timed duration. */
    onEnd?: () => void
  }

  const Pacman: ComponentType<ReactPacmanProps>
  export default Pacman
}
