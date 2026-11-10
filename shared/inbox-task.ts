export type InboxTaskStatus =
  | "queued"
  | "running"
  | "waiting-input"
  | "waiting-work"
  | "replied"
  | "failed"
  | "stopped"
  | "interrupted";

export interface InboxTask {
  id: string;
  botId: string;
  threadId: string;
  sendId: string;
  title: string;
  status: InboxTaskStatus;
  createdAt: number;
  updatedAt: number;
  sourceMessageId?: string;
  executionId?: string;
  resultMessageId?: string;
  seenAt?: number;
  reason?: string;
  progress?: { text: string; at: number };
  cardMessageId?: string;
}
