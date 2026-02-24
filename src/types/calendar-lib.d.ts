declare module 'date-fns' {
  export function format(...args: unknown[]): string
  export function getDay(...args: unknown[]): number
  export function parse(...args: unknown[]): Date
  export function startOfWeek(...args: unknown[]): Date
}

declare module 'date-fns/locale' {
  export const enUS: unknown
}

declare module 'react-big-calendar' {
  import type { ComponentType } from 'react'

  export type Event = {
    title: string
    start: Date
    end: Date
    allDay?: boolean
    resource?: unknown
  }

  export const Calendar: ComponentType<Record<string, unknown>>
  export function dateFnsLocalizer(args: unknown): unknown
}
