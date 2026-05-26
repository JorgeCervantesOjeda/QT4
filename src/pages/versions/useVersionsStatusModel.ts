// src/pages/versions/useVersionsStatusModel.ts
// Owns version status presentation, review timers, and automatic review completion.
import { useEffect, useMemo } from "react";
import type { MutableRefObject } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import {
  formatApproxCountdown,
  shouldAutoSetReviewed,
} from "../../lib/reviewWindow";
import type { DocumentSummary, VersionSummary } from "./types";

type UseVersionsStatusModelParams = {
  autoReviewPermissionDeniedVersionIdsRef: MutableRefObject<Set<string>>;
  autoReviewUpdateRef: MutableRefObject<string | null>;
  canManageLatestVersion: boolean;
  clockNowMs: number;
  documentData: DocumentSummary | null;
  hasSelectedVersionComments: boolean;
  isLoadingThreads: boolean;
  latestSelectedVersionCommentAt?: Date | null;
  latestVersion: VersionSummary | null;
  latestVersionIsSelected: boolean;
  selectedVersion: VersionSummary | null;
  selectedVersionHasReviewGrace: boolean;
  selectedVersionReviewGraceRemainingMs: number;
  setClockNowMs: (value: number) => void;
  setError: (value: string | null) => void;
  setIsMembersTableCompact: (value: boolean) => void;
  statusClassName: (status?: string | null) => string;
  userId: string;
};

const versionSelectStatusClassName = (
  version?: Pick<VersionSummary, "status" | "reviewEndAt"> | null,
) => {
  switch (version?.status) {
    case "In Creation":
      return "version-select--in-creation";
    case "In Review":
      return "version-select--in-review";
    case "Reviewed":
      return "version-select--reviewed";
    case "Accepted":
      return "version-select--accepted";
    case "Rejected":
      return "version-select--rejected";
    case "Replaced":
      return "version-select--replaced";
    default:
      return "";
  }
};

const versionStatusColor = (
  version?: Pick<VersionSummary, "status" | "reviewEndAt"> | null,
) => {
  switch (version?.status) {
    case "In Review":
      return "#fff59d";
    case "Reviewed":
      return "#d3d3d3";
    case "Accepted":
      return "#c8f7c5";
    case "Rejected":
      return "#f4c7c3";
    case "Replaced":
      return "#d3d3d3";
    default:
      return "#ffffff";
  }
};

const useVersionsStatusModel = ({
  autoReviewPermissionDeniedVersionIdsRef,
  autoReviewUpdateRef,
  canManageLatestVersion,
  clockNowMs,
  documentData,
  hasSelectedVersionComments,
  isLoadingThreads,
  latestSelectedVersionCommentAt,
  latestVersion,
  latestVersionIsSelected,
  selectedVersion,
  selectedVersionHasReviewGrace,
  selectedVersionReviewGraceRemainingMs,
  setClockNowMs,
  setError,
  setIsMembersTableCompact,
  statusClassName,
  userId,
}: UseVersionsStatusModelParams) => {
  const versionStatusClassName = (
    version?: Pick<VersionSummary, "status" | "reviewEndAt"> | null,
  ) => statusClassName(version?.status);
  const selectedReviewTimerState = useMemo(
    () =>
      !selectedVersion || selectedVersion.status !== "In Review"
        ? "inactive"
        : selectedVersion.reviewEndAt
          ? selectedVersion.reviewEndAt.getTime() > clockNowMs
            ? "active"
            : selectedVersionHasReviewGrace
              ? "grace"
              : "expired"
          : "noExpiration",
    [selectedVersion, clockNowMs, selectedVersionHasReviewGrace],
  );
  const selectedReviewTimerLabel = useMemo(() => {
    if (!selectedVersion || selectedVersion.status !== "In Review") return null;
    if (!selectedVersion.reviewEndAt) return "No expiration configured";
    const remainingMs = selectedVersion.reviewEndAt.getTime() - clockNowMs;
    return remainingMs <= 0
      ? selectedVersionHasReviewGrace
        ? `Grace ${formatApproxCountdown(selectedVersionReviewGraceRemainingMs)}`
        : "Expired"
      : formatApproxCountdown(remainingMs);
  }, [
    selectedVersion,
    clockNowMs,
    selectedVersionHasReviewGrace,
    selectedVersionReviewGraceRemainingMs,
  ]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockNowMs(Date.now());
    }, 60 * 1e3);
    return () => {
      window.clearInterval(timer);
    };
  }, [setClockNowMs]);
  useEffect(() => {
    if (typeof window > "u") return;
    const media = window.matchMedia("(max-width: 480px)");
    const handleChange = () => {
      setIsMembersTableCompact(media.matches);
    };
    handleChange();
    if (typeof media.addEventListener == "function") {
      media.addEventListener("change", handleChange);
      return () => {
        media.removeEventListener("change", handleChange);
      };
    }
    media.addListener(handleChange);
    return () => {
      media.removeListener(handleChange);
    };
  }, [setIsMembersTableCompact]);
  useEffect(() => {
    if (
      !latestVersion ||
      !userId ||
      !canManageLatestVersion ||
      !selectedVersion ||
      selectedVersion.id !== latestVersion.id ||
      autoReviewPermissionDeniedVersionIdsRef.current.has(latestVersion.id) ||
      autoReviewUpdateRef.current === latestVersion.id ||
      (latestVersionIsSelected && isLoadingThreads) ||
      (latestVersion.numComments > 0 &&
        latestVersionIsSelected &&
        !latestSelectedVersionCommentAt) ||
      (latestVersionIsSelected && selectedVersionHasReviewGrace) ||
      !shouldAutoSetReviewed({
        versionStatus: latestVersion.status,
        reviewEndAt: latestVersion.reviewEndAt,
        latestVersionCommentAt: latestSelectedVersionCommentAt,
        hasAnyComments: hasSelectedVersionComments,
        nowMs: clockNowMs,
      })
    ) {
      return;
    }
    autoReviewUpdateRef.current = latestVersion.id;
    updateDoc(doc(db, "versions", latestVersion.id), {
      status: "Reviewed",
      updatedAt: serverTimestamp(),
      updatedBy: userId,
    }).catch((err) => {
      const message = err instanceof Error ? err.message : "Unexpected error";
      const errorCode =
        err && typeof err == "object" && "code" in err ? String(err.code) : "";
      const loweredMessage = message.toLowerCase();
      const permissionDenied =
        errorCode.includes("permission-denied") ||
        loweredMessage.includes("permission-denied") ||
        loweredMessage.includes("missing or insufficient permissions");
      if (permissionDenied) {
        autoReviewPermissionDeniedVersionIdsRef.current.add(latestVersion.id);
      }
      console.warn("Auto review completion failed:", message);
      if (!permissionDenied) {
        autoReviewUpdateRef.current = null;
      }
    });
  }, [
    latestVersion,
    selectedVersion,
    latestSelectedVersionCommentAt,
    hasSelectedVersionComments,
    clockNowMs,
    userId,
    canManageLatestVersion,
    latestVersionIsSelected,
    isLoadingThreads,
    selectedVersionHasReviewGrace,
    autoReviewPermissionDeniedVersionIdsRef,
    autoReviewUpdateRef,
  ]);
  useEffect(() => {
    if (
      documentData &&
      documentData.type === "errorReport" &&
      (!documentData.baseDocId || !documentData.baseVersionId)
    ) {
      const invalidErrorReportTimer = window.setTimeout(() => {
        setError(
          "Invalid error report data: baseDocId and baseVersionId are required.",
        );
      }, 0);
      return () => {
        window.clearTimeout(invalidErrorReportTimer);
      };
    }
  }, [documentData, setError]);

  return {
    selectedReviewTimerLabel,
    selectedReviewTimerState,
    versionSelectStatusClassName,
    versionStatusClassName,
    versionStatusColor,
  };
};

export default useVersionsStatusModel;
