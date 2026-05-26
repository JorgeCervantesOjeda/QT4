// URL query-state, dashboard focus, and local view-preference synchronization for VersionsPage.
import { useEffect } from 'react'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import type { SortingState } from '@tanstack/react-table'
import type { CommentSummary, DashboardFocusTarget, ThreadSummary, VersionSummary } from './types'
import { buildCommentAnchorId } from './utils'

type UseThreadQueryNavigationParams = {
  threadIdFromQuery: string
  effectiveSelectedThreadId: string | null
  commentIdFromQuery: string
  threads: ThreadSummary[]
  commentsByThread: Record<string, CommentSummary[]>
  commentsViewMode: 'card' | 'table'
  selectedThreadId: string | null
  lastAppliedThreadQueryRef: MutableRefObject<string | null>
  lastAppliedCommentQueryRef: MutableRefObject<string | null>
  pendingManualThreadSelectionRef: MutableRefObject<string | null>
  preservedThreadNavigationScrollYRef: MutableRefObject<number | null>
  setSelectedThreadId: Dispatch<SetStateAction<string | null>>
  setNewCommentBody: Dispatch<SetStateAction<string>>
  setCommentsViewMode: Dispatch<SetStateAction<'card' | 'table'>>
  setHighlightedCommentId: Dispatch<SetStateAction<string | null>>
}

function useThreadQueryNavigation( {
  threadIdFromQuery,
  effectiveSelectedThreadId,
  commentIdFromQuery,
  threads,
  commentsByThread,
  commentsViewMode,
  selectedThreadId,
  lastAppliedThreadQueryRef,
  lastAppliedCommentQueryRef,
  pendingManualThreadSelectionRef,
  preservedThreadNavigationScrollYRef,
  setSelectedThreadId,
  setNewCommentBody,
  setCommentsViewMode,
  setHighlightedCommentId,
}: UseThreadQueryNavigationParams ) {
  useEffect( () => {
    if( !threadIdFromQuery ) {
      lastAppliedThreadQueryRef.current = null
      return
    }
    if( lastAppliedThreadQueryRef.current === threadIdFromQuery ) {
      return
    }
    if( !threads.some( ( thread ) => thread.id === threadIdFromQuery ) ) {
      return
    }
    lastAppliedThreadQueryRef.current = threadIdFromQuery
    setSelectedThreadId( ( current ) => ( current === threadIdFromQuery ? current : threadIdFromQuery ) )
  }, [ threadIdFromQuery, threads, lastAppliedThreadQueryRef, setSelectedThreadId ] )

  useEffect( () => {
    setNewCommentBody( '' )
  }, [ effectiveSelectedThreadId, setNewCommentBody ] )

  useEffect( () => {
    if( preservedThreadNavigationScrollYRef.current === null ) {
      return
    }
    const targetScrollY = preservedThreadNavigationScrollYRef.current
    let secondFrame: number | null = null
    const firstFrame = window.requestAnimationFrame( () => {
      window.scrollTo( { top: targetScrollY, behavior: 'auto' } )
      secondFrame = window.requestAnimationFrame( () => {
        window.scrollTo( { top: targetScrollY, behavior: 'auto' } )
        preservedThreadNavigationScrollYRef.current = null
      } )
    } )
    return () => {
      window.cancelAnimationFrame( firstFrame )
      if( secondFrame !== null ) {
        window.cancelAnimationFrame( secondFrame )
      }
    }
  }, [ selectedThreadId, preservedThreadNavigationScrollYRef ] )

  useEffect( () => {
    if( !commentIdFromQuery ) {
      lastAppliedCommentQueryRef.current = null
      pendingManualThreadSelectionRef.current = null
      setHighlightedCommentId( null )
      return
    }
    if( pendingManualThreadSelectionRef.current ) {
      return
    }
    if( lastAppliedCommentQueryRef.current === commentIdFromQuery ) {
      return
    }
    const targetThreadId =
      effectiveSelectedThreadId ??
      Object.entries( commentsByThread ).find( ( [ , threadComments ] ) =>
        threadComments.some( ( comment ) => comment.id === commentIdFromQuery ),
      )?.[0] ??
      null
    if( !targetThreadId ) {
      return
    }
    if( effectiveSelectedThreadId !== targetThreadId ) {
      setSelectedThreadId( targetThreadId )
      return
    }
    const selectedComments = commentsByThread[targetThreadId] ?? []
    if( !selectedComments.some( ( comment ) => comment.id === commentIdFromQuery ) ) {
      return
    }
    if( commentsViewMode !== 'card' ) {
      setCommentsViewMode( 'card' )
      return
    }
    lastAppliedCommentQueryRef.current = commentIdFromQuery
    setHighlightedCommentId( commentIdFromQuery )
    const scrollTimer = window.setTimeout( () => {
      const commentNode = document.getElementById( buildCommentAnchorId( commentIdFromQuery ) )
      commentNode?.scrollIntoView( { behavior: 'smooth', block: 'center' } )
    }, 120 )
    const clearHighlightTimer = window.setTimeout( () => {
      setHighlightedCommentId( ( current ) => ( current === commentIdFromQuery ? null : current ) )
    }, 12000 )
    return () => {
      window.clearTimeout( scrollTimer )
      window.clearTimeout( clearHighlightTimer )
    }
  }, [
    commentIdFromQuery,
    effectiveSelectedThreadId,
    commentsByThread,
    commentsViewMode,
    lastAppliedCommentQueryRef,
    pendingManualThreadSelectionRef,
    setCommentsViewMode,
    setHighlightedCommentId,
    setSelectedThreadId,
  ] )
}

type UseDashboardFocusParams = {
  dashboardFocusTarget: DashboardFocusTarget | null
  selectedVersion: VersionSummary | null
  selectedThread: ThreadSummary | null
  effectiveSelectedThreadId: string | null
  isLoadingVersions: boolean
  isLoadingThreads: boolean
  lastAppliedDashboardFocusRef: MutableRefObject<string | null>
  versionsActionsRef: RefObject<HTMLDivElement | null>
  filePanelRef: RefObject<HTMLElement | null>
  reviewIssuesPanelRef: RefObject<HTMLElement | null>
  commentInputRef: RefObject<HTMLTextAreaElement | null>
}

function useDashboardFocus( {
  dashboardFocusTarget,
  selectedVersion,
  selectedThread,
  effectiveSelectedThreadId,
  isLoadingVersions,
  isLoadingThreads,
  lastAppliedDashboardFocusRef,
  versionsActionsRef,
  filePanelRef,
  reviewIssuesPanelRef,
  commentInputRef,
}: UseDashboardFocusParams ) {
  useEffect( () => {
    if( !dashboardFocusTarget ) {
      return
    }
    if( !selectedVersion || isLoadingVersions ) {
      return
    }
    if( dashboardFocusTarget === 'comments' && isLoadingThreads ) {
      return
    }

    const focusKey = dashboardFocusTarget === 'comments'
      ? `${dashboardFocusTarget}|${selectedVersion.id}|${effectiveSelectedThreadId ?? ''}`
      : `${dashboardFocusTarget}|${selectedVersion.id}`
    if( lastAppliedDashboardFocusRef.current === focusKey ) {
      return
    }

    const scrollToTarget = (target: HTMLElement | null, focusInput = false) => {
      if( !target ) {
        return false
      }
      target.scrollIntoView( { behavior: 'smooth', block: 'start' } )
      if( focusInput && commentInputRef.current ) {
        window.setTimeout( () => {
          commentInputRef.current?.focus()
        }, 220 )
      }
      return true
    }

    let didScroll = false
    if( dashboardFocusTarget === 'actions' ) {
      didScroll = scrollToTarget( versionsActionsRef.current )
    } else if( dashboardFocusTarget === 'file' ) {
      didScroll = scrollToTarget( filePanelRef.current )
    } else if( dashboardFocusTarget === 'issues' ) {
      didScroll = scrollToTarget( reviewIssuesPanelRef.current )
    } else if( selectedThread ) {
      didScroll = scrollToTarget( commentInputRef.current, true )
    } else {
      didScroll = scrollToTarget( reviewIssuesPanelRef.current )
    }

    if( didScroll ) {
      lastAppliedDashboardFocusRef.current = focusKey
    }
  }, [
    dashboardFocusTarget,
    selectedVersion,
    selectedThread,
    effectiveSelectedThreadId,
    isLoadingVersions,
    isLoadingThreads,
    lastAppliedDashboardFocusRef,
    versionsActionsRef,
    filePanelRef,
    reviewIssuesPanelRef,
    commentInputRef,
  ] )
}

type UseVersionPreferencesParams = {
  viewMode: 'card' | 'table'
  versionSorting: SortingState
  threadsViewMode: 'card' | 'table'
  commentsViewMode: 'card' | 'table'
  setVersionSorting: Dispatch<SetStateAction<SortingState>>
}

function useVersionPreferences( {
  viewMode,
  versionSorting,
  threadsViewMode,
  commentsViewMode,
  setVersionSorting,
}: UseVersionPreferencesParams ) {
  useEffect( () => {
    const storedVersionSorting = window.localStorage.getItem( 'qt4_versions_sorting' )
    if( storedVersionSorting ) {
      try {
        const parsed = JSON.parse( storedVersionSorting ) as SortingState
        if( Array.isArray( parsed ) ) {
          setVersionSorting( parsed )
        }
      } catch {
        // ignore parse errors
      }
    }
  }, [ setVersionSorting ] )

  useEffect( () => {
    window.localStorage.setItem( 'qt4_versions_view', viewMode )
  }, [ viewMode ] )

  useEffect( () => {
    window.localStorage.setItem( 'qt4_versions_sorting', JSON.stringify( versionSorting ) )
  }, [ versionSorting ] )

  useEffect( () => {
    window.localStorage.setItem( 'qt4_versions_threads_view', threadsViewMode )
  }, [ threadsViewMode ] )

  useEffect( () => {
    window.localStorage.setItem( 'qt4_versions_thread_comments_view', commentsViewMode )
  }, [ commentsViewMode ] )
}

export { useDashboardFocus, useThreadQueryNavigation, useVersionPreferences }
