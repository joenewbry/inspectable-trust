// Async job queue, file-backed.
//
// `trust ask <peer> "..."` returns a job ID immediately. The daemon picks it
// up, runs the session, and writes the result back. `trust status` and
// `trust result` poll the file to check progress.
//
// Jobs live at `<trustDir>/jobs/<id>.json`. Each is small, written atomically.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export type JobStatus = "pending" | "running" | "done" | "failed";

export interface Job {
  id: string;
  status: JobStatus;
  created: string;
  started?: string;
  finished?: string;
  /** Slug of the peer to ask. */
  peer: string;
  /** Plain-English intent. */
  intent: string;
  /** Sequential commands to issue. */
  commands: { frame: string; command: string }[];
  /** Free-form result text once done. */
  result?: string;
  /** Each turn that happened. */
  turns?: { outFrame: string; outBody: string; inFrame: string; inBody: string }[];
  /** Error message if failed. */
  error?: string;
  /** Cost in USD. */
  cost?: number;
}

function jobsDir(trustDir: string): string {
  return join(trustDir, "jobs");
}

export function createJob(trustDir: string, init: Omit<Job, "id" | "status" | "created">): Job {
  mkdirSync(jobsDir(trustDir), { recursive: true });
  const job: Job = {
    id: randomUUID(),
    status: "pending",
    created: new Date().toISOString(),
    ...init,
  };
  writeJob(trustDir, job);
  return job;
}

export function listPendingJobs(trustDir: string): Job[] {
  const dir = jobsDir(trustDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Job)
    .filter((j) => j.status === "pending");
}

export function loadJob(trustDir: string, id: string): Job | null {
  const path = join(jobsDir(trustDir), `${id}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Job;
}

export function writeJob(trustDir: string, job: Job): void {
  const path = join(jobsDir(trustDir), `${job.id}.json`);
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(job, null, 2), "utf8");
  renameSync(tmp, path);
}

export function markRunning(trustDir: string, job: Job): void {
  job.status = "running";
  job.started = new Date().toISOString();
  writeJob(trustDir, job);
}

export function markDone(
  trustDir: string,
  job: Job,
  result: string,
  turns: Job["turns"],
  cost: number,
): void {
  job.status = "done";
  job.finished = new Date().toISOString();
  job.result = result;
  job.turns = turns;
  job.cost = cost;
  writeJob(trustDir, job);
}

export function markFailed(trustDir: string, job: Job, error: string, cost = 0): void {
  job.status = "failed";
  job.finished = new Date().toISOString();
  job.error = error;
  job.cost = cost;
  writeJob(trustDir, job);
}
