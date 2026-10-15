import type { TpmApi } from '@shared/api'

declare global {
  interface Window {
    tpm: TpmApi
  }
}

export {}
