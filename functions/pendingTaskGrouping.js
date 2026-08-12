// functions/pendingTaskGrouping.js: Groups dashboard tasks for AI urgency summaries.
const MAX_DASHBOARD_TASKS = 80
const MAX_RECENT_EXPIRED_TASKS = 20
const RECENT_EXPIRED_DAYS = 14
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000
const TASK_TYPE_PRIORITY = {
  reply: 1,
  reviewer: 2,
  authoring: 3,
  acceptedReport: 4,
}
const DOCUMENT_REFERENCE_TITLE_PATTERN = /^\s*(\d+)\s+-\s+(.+?)\s*$/u

const parseDate = (value) => {
  if( !value ) {
    return null
  }
  if( value instanceof Date ) {
    return Number.isNaN( value.getTime() ) ? null : value
  }
  if( value && typeof value.toDate === "function" ) {
    const date = value.toDate()
    return Number.isNaN( date.getTime() ) ? null : date
  }
  if( typeof value === "string" ) {
    const date = new Date( value )
    return Number.isNaN( date.getTime() ) ? null : date
  }
  return null
}

const countTasksByType = (tasks) => tasks.reduce( (counts, task) => {
  const type = task.type || "unknown"
  counts[type] = ( counts[type] || 0 ) + 1
  return counts
}, {} )

const getTaskPriority = (task) => TASK_TYPE_PRIORITY[task.type] || 99

const getTaskDate = (task) => parseDate( task.reviewEndAt ) || parseDate( task.createdAt )

const getDocumentReference = (task) => {
  const shortId = task.documentShortId ?? task.shortId ?? null
  const title = task.documentTitle || ""
  if( shortId !== null && shortId !== undefined ) {
    return {
      documentShortId: shortId,
      documentTitle: title,
      label: title ? `${shortId} - ${title}` : String( shortId ),
    }
  }
  const match = typeof task.title === "string" ? task.title.match( DOCUMENT_REFERENCE_TITLE_PATTERN ) : null
  if( !match ) {
    return null
  }
  return {
    documentShortId: Number( match[1] ),
    documentTitle: match[2],
    label: `${match[1]} - ${match[2]}`,
  }
}

const summarizeTaskForAi = (task) => {
  const documentReference = getDocumentReference( task )
  return {
    type: task.type || "",
    documentShortId: documentReference?.documentShortId ?? null,
    documentTitle: documentReference?.documentTitle ?? "",
    documentLabel: documentReference?.label ?? "",
    detail: task.detail || "",
    lifecycleState: task.lifecycleState || "active",
    visualState: task.visualState || "",
    projectId: task.projectId || "",
    reviewEndAt: task.reviewEndAt || null,
    reviewPeriodState: task.reviewPeriodState || "",
    createdAt: task.createdAt || null,
  }
}

const compareTasksForAi = (taskA, taskB) => {
  const priorityDifference = getTaskPriority( taskA ) - getTaskPriority( taskB )
  if( priorityDifference !== 0 ) {
    return priorityDifference
  }
  const dateA = getTaskDate( taskA )
  const dateB = getTaskDate( taskB )
  if( dateA && dateB ) {
    return dateA.getTime() - dateB.getTime()
  }
  if( dateA ) {
    return -1
  }
  if( dateB ) {
    return 1
  }
  return String( taskA.id || "" ).localeCompare( String( taskB.id || "" ) )
}

const isRecentlyExpiredTask = (task, now) => {
  const expiredAt = parseDate( task.reviewEndAt ) || parseDate( task.createdAt )
  if( !expiredAt ) {
    return false
  }
  const ageInMilliseconds = now.getTime() - expiredAt.getTime()
  return ageInMilliseconds >= 0 && ageInMilliseconds <= RECENT_EXPIRED_DAYS * MILLISECONDS_PER_DAY
}

const summarizeHistoricalExpiredTasks = (tasks) => {
  const dates = tasks
    .map( (task) => getTaskDate( task ) )
    .filter( Boolean )
    .sort( (dateA, dateB) => dateA.getTime() - dateB.getTime() )
  const projectIds = [ ...new Set( tasks.map( (task) => task.projectId ).filter( Boolean ) ) ]
  return {
    total: tasks.length,
    countsByType: countTasksByType( tasks ),
    oldestDate: dates[0] ? dates[0].toISOString() : null,
    newestDate: dates[dates.length - 1] ? dates[dates.length - 1].toISOString() : null,
    sampleProjectCount: projectIds.length,
  }
}

const groupPendingTasksForAi = (tasks, now = new Date()) => {
  const activeTasks = tasks.filter( (task) => task.lifecycleState !== "expired" )
  const expiredTasks = tasks.filter( (task) => task.lifecycleState === "expired" )
  const recentExpiredTasks = expiredTasks.filter( (task) => isRecentlyExpiredTask( task, now ) )
  const historicalExpiredTasks = expiredTasks.filter( (task) => !isRecentlyExpiredTask( task, now ) )
  const sortedActiveTasks = [ ...activeTasks ].sort( compareTasksForAi )
  const sortedRecentExpiredTasks = [ ...recentExpiredTasks ].sort( compareTasksForAi )
  return {
    recentExpiredWindow: `${RECENT_EXPIRED_DAYS} days`,
    counts: {
      total: tasks.length,
      active: activeTasks.length,
      expired: expiredTasks.length,
      recentExpired: recentExpiredTasks.length,
      historicalExpired: historicalExpiredTasks.length,
    },
    countsByType: countTasksByType( tasks ),
    activeCountsByType: countTasksByType( activeTasks ),
    recentExpiredCountsByType: countTasksByType( recentExpiredTasks ),
    activeTasks: sortedActiveTasks.slice( 0, MAX_DASHBOARD_TASKS ).map( summarizeTaskForAi ),
    recentExpiredTasks: sortedRecentExpiredTasks.slice( 0, MAX_RECENT_EXPIRED_TASKS ).map( summarizeTaskForAi ),
    historicalExpiredSummary: summarizeHistoricalExpiredTasks( historicalExpiredTasks ),
    truncated: {
      activeTasks: activeTasks.length > MAX_DASHBOARD_TASKS,
      recentExpiredTasks: recentExpiredTasks.length > MAX_RECENT_EXPIRED_TASKS,
    },
  }
}

module.exports = {
  groupPendingTasksForAi,
}
