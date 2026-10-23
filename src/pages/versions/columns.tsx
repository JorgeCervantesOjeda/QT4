// src/pages/versions/columns.tsx: Defines table columns for versions, members, issues, and comments.
import { useMemo } from "react";
import { deriveThreadActivityAt } from './threadOrdering';
import type { ColumnDef } from "@tanstack/react-table";
import { versionNumberToString } from "../../domain/types";
import { formatTimeAgoWithTimestamp } from "../../lib/time";
import type {
  CommentReactionKind,
  CommentReactionState,
  CommentSummary,
  FileRefSummary,
  ThreadSummary,
  VersionSummary,
} from "./types";
import type { MemberAssignmentRow } from "./AuthorReviewerAssignmentPanel";
import {
  formatReviewPeriodLabel,
  formatFileExtensionLabel,
  formatStorageProviderLabel,
} from "./utils";

type VersionColumnsParams = {
  formatUserLabel: (userId: string) => string;
  requestDownloadVersionFile: (version: VersionSummary) => void;
  isBusy: boolean;
  downloadStatus: "idle" | "downloading";
  getVersionDownloadProvider: (
    version: VersionSummary,
  ) => ReturnType<
    typeof import("../../lib/fileStorage").getEffectiveFileStorageProviderHint
  >;
  clockNowMs: number;
  versionFileRefsById: Record<string, FileRefSummary>;
};

const useVersionColumns = (params: VersionColumnsParams) =>
  useMemo<ColumnDef<VersionSummary>[]>(
    () => [
      {
        header: "Version",
        accessorKey: "number",
        cell: (info) => versionNumberToString(info.getValue<number>()),
      },
      {
        header: "Status",
        accessorKey: "status",
      },
      {
        header: "Author",
        accessorKey: "createdBy",
        cell: (info) => params.formatUserLabel(info.getValue<string>()),
      },
      {
        header: "Reviewers",
        accessorKey: "reviewerIds",
        cell: (info) => String((info.getValue<string[]>() ?? []).length),
      },
      {
        header: "Uploaded",
        accessorKey: "hasFile",
        cell: (info) => {
          const version = info.row.original;
          const fileExtensionLabel = formatFileExtensionLabel(
            version.fileRefId
              ? params.versionFileRefsById[version.fileRefId]
              : null,
          );
          if (!version.hasFile) {
            return "No";
          }
          if (!version.fileRefId) {
            return "Missing metadata";
          }
          return (
            <div className="actions actions--inline">
              <span>Yes</span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  params.requestDownloadVersionFile(version);
                }}
                disabled={
                  params.isBusy || params.downloadStatus === "downloading"
                }
              >
                Download
              </button>
              {fileExtensionLabel ? (
                <span className="download-file-extension">
                  {fileExtensionLabel}
                </span>
              ) : null}
              <span className="download-provider-hint">
                {`From: ${formatStorageProviderLabel(params.getVersionDownloadProvider(version))}`}
              </span>
            </div>
          );
        },
      },
      {
        header: "Review period",
        id: "reviewPeriod",
        cell: (info) => {
          const version = info.row.original;
          return formatReviewPeriodLabel(version, params.clockNowMs);
        },
      },
    ],
    [params],
  );

type CommentColumnsParams = {
  commentReactionsByCommentId: Record<string, CommentReactionState>;
  formatUserLabel: (userId: string) => string;
  onSetCommentReaction: (
    comment: CommentSummary,
    reaction: CommentReactionKind,
  ) => void;
  pendingCommentReactionIds: Record<string, boolean>;
};

const commentReactionOptions: Array<{
  emoji: string;
  kind: CommentReactionKind;
  label: string;
}> = [
  { emoji: "😊", kind: "good", label: "Good" },
  { emoji: "🤔", kind: "regular", label: "Regular" },
  { emoji: "😖", kind: "bad", label: "Bad" },
];

const emptyCommentReactionState: CommentReactionState = {
  counts: {
    good: 0,
    regular: 0,
    bad: 0,
  },
  currentUserReaction: null,
};

const countOfReactions = (
  reactionState: CommentReactionState,
  reaction: CommentReactionKind,
) => Math.max(0, Math.floor(reactionState.counts[reaction] ?? 0));

const formatReactionAriaLabel = (
  comment: CommentSummary,
  reactionState: CommentReactionState,
  reaction: CommentReactionKind,
) => {
  const option = commentReactionOptions.find((item) => item.kind === reaction);
  const label = option?.label ?? reaction;
  const count = countOfReactions(reactionState, reaction);
  const reactionsLabel =
    count === 1 ? `1 ${label} reaction` : `${count} ${label} reactions`;
  return `${label} reaction for comment ${comment.body} ${reactionsLabel}`;
};

const renderReactionFaces = (reactionState: CommentReactionState) => {
  const reactionFaces = commentReactionOptions.flatMap((option) =>
    Array.from({ length: countOfReactions(reactionState, option.kind) }, () =>
      option,
    ),
  );
  if (reactionFaces.length === 0) {
    return null;
  }
  return (
    <span className="comment-reaction-faces" aria-hidden="true">
      {reactionFaces.map((option, index) => (
        <span
          key={`${option.kind}_${index}`}
          className={`comment-reaction-face comment-reaction-face--${option.kind}`}
          data-comment-reaction-kind={option.kind}
          title={option.label}
        >
          {option.emoji}
        </span>
      ))}
    </span>
  );
};

const useCommentColumns = (params: CommentColumnsParams) =>
  useMemo<ColumnDef<CommentSummary>[]>(
    () => [
      {
        header: "Author",
        accessorKey: "createdBy",
        cell: (info) => params.formatUserLabel(info.getValue<string>()),
      },
      {
        header: "Comment",
        accessorKey: "body",
        cell: (info) => {
          const comment = info.row.original;
          const reactionState =
            params.commentReactionsByCommentId[comment.id] ??
            emptyCommentReactionState;
          return (
            <span className="comment-body-with-reactions">
              <span className="comment-body">{comment.body}</span>
              {renderReactionFaces(reactionState)}
            </span>
          );
        },
      },
      {
        header: "When",
        accessorKey: "createdAt",
        cell: (info) => {
          const value = info.getValue<Date | undefined>();
          return value ? formatTimeAgoWithTimestamp(value) : "-";
        },
      },
      {
        header: "Reactions",
        id: "reactions",
        enableSorting: false,
        cell: (info) => {
          const comment = info.row.original;
          const reactionState =
            params.commentReactionsByCommentId[comment.id] ??
            emptyCommentReactionState;
          const isPending = Boolean(params.pendingCommentReactionIds[comment.id]);
          return (
            <div className="comment-reaction-cell" aria-busy={isPending}>
              {commentReactionOptions.map((option) => (
                <button
                  key={option.kind}
                  type="button"
                  className="ghost comment-reaction-button"
                  aria-label={formatReactionAriaLabel(
                    comment,
                    reactionState,
                    option.kind,
                  )}
                  aria-pressed={
                    reactionState.currentUserReaction === option.kind
                  }
                  title={isPending ? "Saving" : option.label}
                  onClick={(event) => {
                    event.stopPropagation();
                    params.onSetCommentReaction(comment, option.kind);
                  }}
                  disabled={isPending}
                >
                  {option.emoji}
                </button>
              ))}
            </div>
          );
        },
      },
    ],
    [params],
  );

const useMemberColumns = (params: {
  handleAssignAuthor: (authorId: string) => void;
  handleToggleReviewer: (reviewerId: string) => void;
  isBusy: boolean;
  isMembersTableCompact: boolean;
}) =>
  useMemo<ColumnDef<MemberAssignmentRow>[]>(() => {
    const columns: ColumnDef<MemberAssignmentRow>[] = [
      {
        header: "Author",
        accessorKey: "isAuthor",
        cell: (info) => {
          const row = info.row.original;
          return (
            <input
              type="radio"
              name="author"
              value={row.userId}
              checked={row.isAuthor}
              onChange={() => params.handleAssignAuthor(row.userId)}
              disabled={params.isBusy}
            />
          );
        },
      },
      {
        header: "Reviewer",
        accessorKey: "isReviewer",
        cell: (info) => {
          const row = info.row.original;
          return (
            <input
              type="checkbox"
              checked={row.isReviewer}
              onChange={() => params.handleToggleReviewer(row.userId)}
              disabled={params.isBusy || row.isAuthor}
            />
          );
        },
      },
      {
        header: "Member",
        accessorKey: "memberLabel",
      },
    ];
    if (!params.isMembersTableCompact) {
      columns.push(
        {
          header: "Role",
          accessorKey: "role",
        },
        {
          header: "Status",
          accessorKey: "statusLabel",
        },
      );
    }
    return columns;
  }, [params]);

const useThreadColumns = (params: {
  formatUserLabel: (userId: string) => string;
  getThreadCommentWindowMeta: (thread: ThreadSummary) => { label: string };
  requestThreadStatusChangeConfirmation: (thread: ThreadSummary) => void;
  isBusy: boolean;
}) =>
  useMemo<ColumnDef<ThreadSummary>[]>(
    () => [
      {
        header: "Status",
        accessorKey: "status",
      },
      {
        header: "Created by",
        accessorKey: "createdBy",
        cell: (info) => params.formatUserLabel(info.getValue<string>()),
      },
      {
        header: "Comments",
        accessorKey: "commentCount",
        cell: (info) => String(info.getValue<number>()),
      },
      {
        header: "Comment window",
        id: "commentWindow",
        cell: (info) =>
          params.getThreadCommentWindowMeta(info.row.original).label,
      },
      {
        header: "Action",
        id: "action",
        cell: (info) => {
          const thread = info.row.original;
          return (
            <button
              type="button"
              className="thread-table-action-button"
              onClick={(event) => {
                event.stopPropagation();
                params.requestThreadStatusChangeConfirmation(thread);
              }}
              disabled={params.isBusy}
            >
              {thread.status === "open" ? "Close" : "Reopen"}
            </button>
          );
        },
      },
      {
        header: "Issue",
        accessorKey: "title",
      },
      {
        header: 'Created',
        id: 'createdAt',
        accessorFn: ( thread ) => thread.createdAt?.getTime(),
        sortingFn: 'basic',
        sortUndefined: 'last',
        cell: ( info ) => info.row.original.createdAt?.toLocaleString() ?? 'Unknown',
      },
      {
        header: 'Last activity',
        id: 'activityAt',
        accessorFn: ( thread ) => deriveThreadActivityAt( thread )?.getTime(),
        sortingFn: 'basic',
        sortUndefined: 'last',
        cell: ( info ) => deriveThreadActivityAt( info.row.original )?.toLocaleString() ?? 'Unknown',
      },
      {
        header: 'Issue ID',
        accessorKey: 'issueNumber',
        sortingFn: 'basic',
        sortUndefined: 'last',
        cell: ( info ) => info.getValue<number | undefined>() ?? 'Unassigned',
      },
    ],
    [params],
  );

export {
  useCommentColumns,
  useMemberColumns,
  useThreadColumns,
  useVersionColumns,
};
