import type { WireTask } from "../shared/wire.ts";
import type { ModelSelection } from "./contracts.ts";
import type { HandedState } from "./delta-context.ts";

export interface TaskRecord extends Omit<WireTask, TaskWireDerivedKeys> {
  resumeCursors: Record<string, unknown>;
  lastInstanceId?: string;
  handedMessages?: Record<string, HandedState>;
  appliedCompactionId?: string;
  contextFloor?: number;
  lastContextModel?: string;
  /** Absent (legacy) may be a person's choice: only an "auto" pin yields to a Works on change. */
  surfaceSource?: "user" | "auto";
  /** Epoch ms a person last wrote here: never a teammate, routine, webhook, the bot itself or a Slack relay. */
  askedAt?: number;
}

export type TaskWirePrivateKeys = "resumeCursors" | "lastInstanceId" | "handedMessages" | "appliedCompactionId" | "contextFloor" | "lastContextModel" | "surfaceSource" | "askedAt";
export type TaskWireDerivedKeys = "surfaceAuto" | "followsBotModel";
export type TaskWireProjection = Pick<TaskRecord, Exclude<keyof TaskRecord, TaskWirePrivateKeys>> & Pick<WireTask, TaskWireDerivedKeys>;
export type AssertExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export type AssertSameKeys<A, B> = [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : never) : never;
/** TS lets an optional extra field through (a type without it still extends {field?: T}), so keys are checked too. */
export type TaskWireProjectionIsExact = AssertExact<WireTask, TaskWireProjection> & AssertSameKeys<WireTask, TaskWireProjection>;
export const taskWireProjectionIsExact: TaskWireProjectionIsExact = true;

export function toWireTask(task: TaskRecord, botModel: ModelSelection): WireTask {
  const { resumeCursors: _resumeCursors, lastInstanceId: _lastInstanceId, handedMessages: _handedMessages,
    appliedCompactionId: _appliedCompactionId, contextFloor: _contextFloor, lastContextModel: _lastContextModel,
    surfaceSource, askedAt: _askedAt, ...stored } = task;
  const wire: WireTask = { ...stored, modelSelection: structuredClone(task.modelSelection ?? botModel), followsBotModel: task.modelSelection === undefined };
  return surfaceSource === "auto" && wire.surface !== undefined ? { ...wire, surfaceAuto: true } : wire;
}
