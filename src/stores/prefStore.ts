import { create } from 'zustand'

interface PrefState {
  coloredAvatars: boolean
  setColoredAvatars: (v: boolean) => void
}

export const usePrefStore = create<PrefState>((set) => ({
  coloredAvatars: localStorage.getItem('thelight.coloredAvatars') !== 'false',
  setColoredAvatars: (v: boolean) => {
    localStorage.setItem('thelight.coloredAvatars', String(v))
    set({ coloredAvatars: v })
  },
}))
