// Table column definitions for versions, members, issues, and comments.
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { versionNumberToString } from "../../domain/types";
import { formatTimeAgoWithTimestamp } from "../../lib/time";
import type {
  CommentLikeState,
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
  commentLikesByCommentId: Record<string, CommentLikeState>;
  formatUserLabel: (userId: string) => string;
  onToggleCommentLike: (comment: CommentSummary) => void;
  pendingCommentLikeIds: Record<string, boolean>;
};

const formatLikeAriaLabel = (comment: CommentSummary, likeState: CommentLikeState) => {
  const action = likeState.likedByCurrentUser ? "Unlike" : "Like";
  const likesLabel = likeState.count === 1 ? "1 like" : `${likeState.count} likes`;
  return `${action} comment ${comment.body} ${likesLabel}`;
};

const getLikeHandValues = (count: number) => {
  const safeCount = Math.max(0, Math.floor(count));
  const numOfHundreds = Math.floor(safeCount / 100);
  const numOfTens = Math.floor((safeCount % 100) / 10);
  const numOfOnes = safeCount % 10;
  return [
    ...Array.from({ length: numOfHundreds }, () => 100),
    ...Array.from({ length: numOfTens }, () => 10),
    ...Array.from({ length: numOfOnes }, () => 1),
  ];
};

const renderLikeHands = (count: number) => {
  const likeHandValues = getLikeHandValues(count);
  if (likeHandValues.length === 0) {
    return null;
  }
  return (
    <span className="comment-like-hands" aria-hidden="true">
      {likeHandValues.map((value, index) => (
        <span
          key={`${value}_${index}`}
          className={`comment-like-hand comment-like-hand--${value}`}
          data-like-value={String(value)}
          title={`${value} ${value === 1 ? "like" : "likes"}`}
        >
          👍
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
          const likeState = params.commentLikesByCommentId[comment.id] ?? {
            count: 0,
            likedByCurrentUser: false,
          };
          return (
            <span className="comment-body-with-likes">
              <span>{comment.body}</span>
              {renderLikeHands(likeState.count)}
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
        header: "Likes",
        id: "likes",
        enableSorting: false,
        cell: (info) => {
          const comment = info.row.original;
          const likeState = params.commentLikesByCommentId[comment.id] ?? {
            count: 0,
            likedByCurrentUser: false,
          };
          const isPending = Boolean(params.pendingCommentLikeIds[comment.id]);
          const actionLabel = likeState.likedByCurrentUser ? "Unlike" : "Like";
          return (
            <div className="comment-like-cell">
              <button
                type="button"
                className="ghost comment-like-button"
                aria-label={formatLikeAriaLabel(comment, likeState)}
                aria-pressed={likeState.likedByCurrentUser}
                onClick={(event) => {
                  event.stopPropagation();
                  params.onToggleCommentLike(comment);
                }}
                disabled={isPending}
              >
                {isPending ? "Saving" : actionLabel}
              </button>
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
    ],
    [params],
  );

export {
  useCommentColumns,
  useMemberColumns,
  useThreadColumns,
  useVersionColumns,
};
