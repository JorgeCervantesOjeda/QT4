// Table column definitions for versions, members, issues, and comments.
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { versionNumberToString } from "../../domain/types";
import { formatTimeAgoWithTimestamp, formatTimestamp } from "../../lib/time";
import { formatApproxCountdown } from "../../lib/reviewWindow";
import type { CommentSummary, ThreadSummary, VersionSummary } from "./types";
import type { MemberAssignmentRow } from "./AuthorReviewerAssignmentPanel";
import { formatStorageProviderLabel } from "./utils";

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
          if (version.status !== "In Review") {
            return "-";
          }
          if (!version.reviewEndAt) {
            return "No expiration";
          }
          const remainingMs = version.reviewEndAt.getTime() - params.clockNowMs;
          if (remainingMs <= 0) {
            return `Main window ended (${formatTimestamp(version.reviewEndAt)})`;
          }
          return `${formatApproxCountdown(remainingMs)} (${formatTimestamp(version.reviewEndAt)})`;
        },
      },
    ],
    [params],
  );

const useCommentColumns = (formatUserLabel: (userId: string) => string) =>
  useMemo<ColumnDef<CommentSummary>[]>(
    () => [
      {
        header: "Author",
        accessorKey: "createdBy",
        cell: (info) => formatUserLabel(info.getValue<string>()),
      },
      {
        header: "Comment",
        accessorKey: "body",
      },
      {
        header: "When",
        accessorKey: "createdAt",
        cell: (info) => {
          const value = info.getValue<Date | undefined>();
          return value ? formatTimeAgoWithTimestamp(value) : "-";
        },
      },
    ],
    [formatUserLabel],
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
