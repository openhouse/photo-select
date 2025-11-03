export type CopyMode = "clone" | "hardlink" | "copy" | "move" | "skip";
export type CopyStrategy = "auto" | "clone" | "hardlink" | "copy" | "move";
export interface CopyEntry {
  op: "copy";
  from: string;
  to: string;
  mode: CopyMode;
  bytes: number;
  ms: number;
  strategy: CopyStrategy;
  ok: boolean;
  via?: string;
  error?: string;
}

export declare function copyFile(
  src: string,
  dst: string,
  strategy?: CopyStrategy,
  options?: {
    dryRun?: boolean;
    requireClone?: boolean;
    journal?: import("./journal.js").OperationJournal;
    emitLog?: (entry: CopyEntry) => void;
  }
): Promise<CopyEntry>;

export declare function copyTree(
  srcDir: string,
  dstDir: string,
  strategy?: CopyStrategy,
  options?: {
    dryRun?: boolean;
    requireClone?: boolean;
    concurrency?: number;
    journal?: import("./journal.js").OperationJournal;
    emitLog?: (entry: CopyEntry) => void;
  }
): Promise<{
  entries: CopyEntry[];
  counts: Record<string, number>;
  ms: number;
  duDelta: number | null;
}>;

export declare function parseStrategy(input?: string): CopyStrategy;
export declare function summarizeCopy(entries: CopyEntry[]): Record<string, number>;
export declare function formatSummary(summary: Record<string, number>): string;

export { OperationJournal } from "./journal.js";
