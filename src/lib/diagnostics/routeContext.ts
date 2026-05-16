export type RouteDiagnosticContext = {
  route: string
  pageUrl: string

  urlDocumentId: string
  urlProjectId: string
  urlVersionId: string
  urlThreadId: string
  urlCommentId: string
  urlFocus: string

  online: boolean
  visibilityState: DocumentVisibilityState
  userAgent: string
}

export function getRouteDiagnosticContext(): RouteDiagnosticContext {
  const url = new URL( window.location.href )

  const documentMatch = url.pathname.match(
    /^\/documents\/([^/]+)\/versions\/?$/,
  )

  return {
    route: `${url.pathname}${url.search}${url.hash}`,
    pageUrl: url.href,

    urlDocumentId: documentMatch?.[1] ?? '',
    urlProjectId: url.searchParams.get( 'projectId' ) ?? '',
    urlVersionId: url.searchParams.get( 'versionId' ) ?? '',
    urlThreadId: url.searchParams.get( 'threadId' ) ?? '',
    urlCommentId: url.searchParams.get( 'commentId' ) ?? '',
    urlFocus: url.searchParams.get( 'focus' ) ?? '',

    online: navigator.onLine,
    visibilityState: document.visibilityState,
    userAgent: navigator.userAgent,
  }
}