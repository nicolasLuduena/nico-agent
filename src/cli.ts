import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADVANCE_INTERVAL_MS, type AdvanceReport, advance } from "./advance";
import { answer, loadAsking } from "./answer";
import { type BoardIssue, loadBoard } from "./board";
import { ConfigError, VOICE_DOC, VOICE_SERVICES, findRepo, loadConfig, saveConfig, standingOrders } from "./config";
import { ORDERS, ORDERS_HELP, type Order, isOrder } from "./orders";
import { AnswerRefused, type Ask, answerQuestion, append, authored, loadConversation, openAsks, openQuestions, readInbox, recall, sayToLead } from "./conversation";
import { StepFailed, baseBranch, closeDispatch, dispatch, eachIssue, resolveIssue, review } from "./dispatch";
import { DispatchError } from "./dispatch-error";
import { PANE_ARGS } from "./opencode";
import { type Catalog, harnessCatalogs, harnesses, refreshHarnesses, rememberedLaunches } from "./harness";
import { LEAD_AGENT, NICO_AGENT_SLUG, leadStatus, startLead, stopLead } from "./lead";
import { describePrs, garden, gardenRepo, gardenerRows, queueGardening, startQueuedGardeners } from "./gardener";
import { NUDGE_INTERVAL_MS, nudgeLead, sendPendingNudge } from "./nudge";
import { linearIdentifier } from "./linear";
import { peek } from "./peek";
import { PR_WATCH_INTERVAL_MS, watchPrs } from "./pr-events";
import { PROPOSABLE, withJson } from "./mcp";
import { ASKS_SCOPE, PROPOSALS_SCOPE, notifyOnce } from "./notify";
import { type Output, plural, render } from "./output";
import { type Proposal, type Proposed, ProposalRefused, type SourceWrite, addProposal, commandLine, decide, describeProposed, loadProposals, openProposals, settle } from "./proposals";
import { dequeue, enqueue, loadQueues, move, pruneBoardQueues, queueOf } from "./queue";
import { RECORDS, type RecordName, StaleRecord, noneYet, readRecord, replaceRecord } from "./records";
import { isCandidate, sameSpec } from "./spec";
import { UnknownRepo, recordSighting, stats } from "./stats";
import { VERSION } from "./version";
import { sameSlug, slugOfRemote } from "./slug";
import { cachingGitHubReads } from "./cached-world";
import { GITHUB_CALLS_FILE, githubUsage, readGitHubCalls, withCaller } from "./github-calls";
import { type PrLookup, cachedPrs, currentStage, freshPrs, loadInFlight, stageOf } from "./stage";
import { type Dispatch, findDispatch, loadDispatches } from "./state";
import { probeVoice } from "./voice";
import { setVoiceOn, voiceOn } from "./voice-on";
import { TALK_PATH, lookAtLead, webHandler, webSockets } from "./web";
import { Events } from "./events";
import app from "./app/index.html";
import { RATE_LIMITED, type World, WorldError, worldErrorMessage } from "./world";

export interface RunContext {
  world: World;
  configDir: string;
  /** Path of the running executable, home collapsed to `~`. */
  bin: string;
  /**
   * The Board's PR lookup, shared by every run of a long-lived caller such as
   * `serve`, which looks PRs up through its cached GitHub reads.
   */
  prs?: PrLookup;
  /** Reads standard input to its end; absent when it is a terminal or there is none. */
  stdin?: () => Promise<string>;
}

export interface RunResult {
  stdout: string;
  exitCode: number;
}

const DESCRIPTION = "Dispatch coding agents onto ready-for-agent issues";
const ADD_REPO_HELP = "Run `nico-agent repo add <owner/name> --path <clone>` to add a Repo";
const BOARD_HELP = "Run `nico-agent` to see the Board";
const DISPATCH_USAGE = "nico-agent dispatch <issue>... --harness <harness> --model <model> --effort <effort>";
const REVIEW_USAGE = "nico-agent review <issue>... --harness <harness> --model <model> --effort <effort>";
const CLOSE_USAGE = "nico-agent close <issue>... [--confirm]";
const ANSWER_USAGE = "nico-agent answer <issue> <text>";
const PEEK_USAGE = "nico-agent peek [<issue>] [--reviewer]";
const ORDERS_SET_USAGE = "nico-agent orders set <order> on|off";
const SAY_USAGE = "nico-agent say [--answer <id>] [--raw <transcript>] <text>";
const LEAD_SAY_USAGE = "nico-agent lead say <text>";
const LEAD_ASK_USAGE = "nico-agent lead ask <question> [<choice>...]";
const GITHUB_USAGE_USAGE = "nico-agent github usage [--since <time>]";
const STATS_USAGE = "nico-agent stats [--days <n>] [--repo <owner/name>]";
const RECALL_USAGE = "nico-agent lead recall <query> [--since <time>] [--until <time>]";
const QUEUE_USAGE = "nico-agent queue <spec> --repo <owner/name>";
const UNQUEUE_USAGE = "nico-agent unqueue <spec> --repo <owner/name>";
const MOVE_USAGE = "nico-agent move <spec> up|down --repo <owner/name>";
const PROPOSE_USAGE = "nico-agent lead propose --reason <why> (-- <command>... | --write <repo> [--file <path> | --text <markdown>])";
const APPROVE_USAGE = "nico-agent proposals approve <id>";
const DECLINE_USAGE = "nico-agent proposals decline <id> [reason]";
const PROPOSALS_HELP = "Run `nico-agent proposals` to see the open Proposals";
const LOG_HELP = "Run `nico-agent lead log` to see the conversation with the Lead";
const GARDEN_USAGE = "nico-agent garden <repo> [--pr <url>...]";
const LEAD_START_USAGE = "nico-agent lead start [--harness <harness>] [--model <model>] [--effort <effort>] [--port <port>]";
const LEAD_STATUS_HELP = "Run `nico-agent lead status` to see the Lead";
const LEAD_SCREEN_HELP = "Run `herdr agent read lead` to see its screen";
const VOICE_DOCS_HELP = `See ${VOICE_DOC} to set up transcribe, speak and scribe under voice in config.json`;
const VOICE_TALK_USAGE = "nico-agent voice talk [--port <port>]";
const VOICE_ON_HELP = "Run `nico-agent voice on` or `nico-agent voice off` to switch it; the app has a Voice switch too";
const LAUNCH_FLAGS = {
  "--harness": { value: true, description: "Harness to launch, e.g. claude (see `nico-agent harness list`)" },
  "--model": { value: true, description: "model for the Harness, e.g. opus" },
  "--effort": { value: true, description: "Effort level for the Harness, e.g. high" },
};

/** An error the user can act on; `exitCode` 2 marks a usage error. */
class CliError extends Error {
  constructor(
    message: string,
    readonly help: string[] = [],
    readonly exitCode: 1 | 2 = 1,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

interface Args {
  positionals: string[];
  /** A flag that `repeats` holds each value given, in order. */
  flags: Record<string, string | true | string[]>;
}

interface Command {
  name: string;
  usage: string;
  summary: string;
  /** Command-specific flags; `value` marks a flag that takes a value, `repeats` one that may be given again. */
  flags: Record<string, { value: boolean; description: string; repeats?: boolean }>;
  /** A last one ending in `...` takes any number of arguments. */
  positionals: string[];
  examples: string[];
  /** Next steps shown with the command's `--help`. */
  help?: string[];
  run(args: Args, ctx: RunContext): Promise<Output>;
}

const GLOBAL_FLAGS = {
  "--json": { value: false, description: "print JSON instead of TOON" },
  "--help": { value: false, description: "show help for the command" },
};

const commands: Command[] = [
  {
    name: "board",
    usage: "nico-agent [board]",
    summary: "Show Ready issues across all Repos (the default view)",
    flags: {},
    positionals: [],
    examples: ["nico-agent", "nico-agent board --json"],
    run: (args, ctx) => board(ctx, args.flags["--json"] === true),
  },
  {
    name: "repo add",
    usage: "nico-agent repo add <owner/name> --path <clone>",
    summary: "Add a Repo after checking the path is a clone of it",
    flags: {
      "--path": { value: true, description: "path of a local clone of the repo (required)" },
      "--linear-team": { value: true, description: "Linear team key, name or ID" },
      "--linear-project": { value: true, description: "Narrow to a Linear project name or ID" },
      "--linear-label": { value: true, description: "Narrow to a Linear label name" },
      "--base": { value: true, description: "Base every Dispatch starts from unless stacked (default: origin's default branch)" },
    },
    positionals: ["owner/name"],
    examples: ["nico-agent repo add acme/api --path ~/src/api", "nico-agent repo add acme/api --path ~/src/api --base beta"],
    run: repoAdd,
  },
  {
    name: "repo rm",
    usage: "nico-agent repo rm <owner/name>",
    summary: "Remove a Repo (its clone is left untouched)",
    flags: {},
    positionals: ["owner/name"],
    examples: ["nico-agent repo rm acme/api"],
    run: repoRm,
  },
  {
    name: "repo list",
    usage: "nico-agent repo list",
    summary: "List the configured Repos",
    flags: {},
    positionals: [],
    examples: ["nico-agent repo list", "nico-agent repo list --json"],
    run: (_args, ctx) => repoList(ctx),
  },
  {
    name: "dispatch",
    usage: DISPATCH_USAGE,
    summary: "Start an Implementer on each issue in a new herdr worktree workspace (resumes a failed one)",
    flags: {
      ...LAUNCH_FLAGS,
      "--stack-on": { value: true, description: "open PR in the Repo to stack on, named by its issue or its PR URL; each Blocker's PR must be it or below it in its Stack; required for a Stackable issue with several Blocker PRs" },
      "--base": { value: true, description: "branch on origin to start from and open the PR against (default: the last one used in the Repo, else the default branch); not for a Stacked dispatch" },
      "--repo": { value: true, description: "Repo to dispatch a Linear issue into; required when several Repos claim it" },
    },
    positionals: ["issue..."],
    examples: [
      "nico-agent dispatch acme/api#7 --harness claude --model opus --effort high",
      "nico-agent dispatch acme/api#7 --harness claude --model opus --effort high --base beta",
      "nico-agent dispatch acme/api#7 acme/api#8 --harness codex --model gpt-5.5 --effort high",
      "nico-agent dispatch https://github.com/acme/api/issues/7 --harness claude --model sonnet --effort max",
      "nico-agent dispatch BLE-27 --harness claude --model opus --effort high --repo acme/api",
      "nico-agent dispatch acme/api#9 --harness claude --model opus --effort high --stack-on acme/api#8",
    ],
    help: ["An issue labelled `research` is a Research issue: its Implementer is sent the `research` prompt, to write findings to docs/research/ (see docs/research-issues.md)"],
    run: dispatchCommand,
  },
  {
    name: "advance",
    usage: "nico-agent advance",
    summary: "Dispatch each running Spec's next issue and start the head of each Repo's Queue while it has room, with the Scheduler defaults from config (skips Held Specs)",
    flags: {},
    positionals: [],
    examples: ["nico-agent advance", "nico-agent advance --json"],
    run: advanceCommand,
  },
  {
    name: "queue",
    usage: QUEUE_USAGE,
    summary: "Put a candidate Spec last in its Repo's Queue, so `advance` starts it when the Repo has room",
    flags: { "--repo": { value: true, description: "Repo whose Queue it joins (required)" } },
    positionals: ["spec"],
    examples: ["nico-agent queue BLE-20 --repo bleentr/pdf-diff", "nico-agent queue acme/api#10 --repo acme/api --json"],
    run: queueCommand,
  },
  {
    name: "unqueue",
    usage: UNQUEUE_USAGE,
    summary: "Take a Spec out of its Repo's Queue",
    flags: { "--repo": { value: true, description: "Repo whose Queue it leaves (required)" } },
    positionals: ["spec"],
    examples: ["nico-agent unqueue BLE-20 --repo bleentr/pdf-diff"],
    run: unqueueCommand,
  },
  {
    name: "move",
    usage: MOVE_USAGE,
    summary: "Move a queued Spec one place toward the head (up) or the tail (down) of its Repo's Queue",
    flags: { "--repo": { value: true, description: "Repo whose Queue it is in (required)" } },
    positionals: ["spec", "up|down"],
    examples: ["nico-agent move BLE-20 up --repo bleentr/pdf-diff", "nico-agent move acme/api#10 down --repo acme/api --json"],
    run: moveCommand,
  },
  {
    name: "review",
    usage: REVIEW_USAGE,
    summary: "Start a Reviewer on each In-flight issue's linked PR, in its workspace (resumes a failed one)",
    flags: LAUNCH_FLAGS,
    positionals: ["issue..."],
    examples: ["nico-agent review acme/api#7 --harness codex --model gpt-5.5 --effort high"],
    run: reviewCommand,
  },
  {
    name: "close",
    usage: CLOSE_USAGE,
    summary: "Remove each Dispatch's workspace and forget it, keeping its branch",
    flags: { "--confirm": { value: false, description: "close even with no PR yet (still Implementing)" } },
    positionals: ["issue..."],
    examples: ["nico-agent close acme/api#7 acme/api#8", "nico-agent close acme/api#7 --confirm"],
    run: closeCommand,
  },
  {
    name: "answer",
    usage: ANSWER_USAGE,
    summary: "Submit text, as typed, to an In-flight issue's Implementer, or a Repo's Gardener, while it waits on the user",
    flags: {},
    positionals: ["issue", "text..."],
    examples: [
      "nico-agent answer acme/api#7 \"2\"",
      "nico-agent answer BLE-27 \"Stop: this is already done in #48\"",
      "nico-agent answer acme/api#7 --json -- \"--force is fine here\"",
      "nico-agent answer acme/api \"Keep both changes\"",
    ],
    help: ["Run `nico-agent --json` to see which Implementers are waiting on you, under `asking`"],
    run: answerCommand,
  },
  {
    name: "peek",
    usage: PEEK_USAGE,
    summary: "Show what an In-flight issue's Implementer (or Reviewer) has on screen right now; with no issue, the Lead's own",
    flags: { "--reviewer": { value: false, description: "the issue's Reviewer instead of its Implementer" } },
    positionals: ["issue"],
    examples: ["nico-agent peek acme/api#7", "nico-agent peek BLE-27 --reviewer --json", "nico-agent peek"],
    run: peekCommand,
  },
  {
    name: "orders",
    usage: "nico-agent orders",
    summary: "Show each Standing order, what it lets the Lead do unasked, and whether it is on",
    flags: {},
    positionals: [],
    examples: ["nico-agent orders", "nico-agent orders --json"],
    run: (args, ctx) => ordersList(ctx, args.flags["--json"] === true),
  },
  {
    name: "orders set",
    usage: ORDERS_SET_USAGE,
    summary: "Turn one Standing order on or off",
    flags: {},
    positionals: ["order", "on|off"],
    examples: ["nico-agent orders set start on", "nico-agent orders set close off"],
    help: [ORDERS_HELP],
    run: ordersSet,
  },
  ...recordCommands("intent", "- Ship billing before the Stripe contract renews"),
  ...recordCommands("notes", "- audit-notes always runs on codex"),
  {
    name: "proposals",
    usage: "nico-agent proposals [--all]",
    summary: "List the Lead's open Proposals: what each would run and why",
    flags: { "--all": { value: false, description: "list decided Proposals too, with their status and outcome" } },
    positionals: [],
    examples: ["nico-agent proposals", "nico-agent proposals --all --json"],
    run: proposalsList,
  },
  {
    name: "proposals approve",
    usage: APPROVE_USAGE,
    summary: "Run an open Proposal's action in nico-agent and report the outcome; one no longer possible is closed as failed",
    flags: {},
    positionals: ["id"],
    examples: ["nico-agent proposals approve 3"],
    help: [PROPOSALS_HELP],
    run: proposalsApprove,
  },
  {
    name: "proposals decline",
    usage: DECLINE_USAGE,
    summary: "Turn down an open Proposal, telling the Lead why",
    flags: {},
    positionals: ["id", "reason..."],
    examples: ["nico-agent proposals decline 3", "nico-agent proposals decline 3 \"Finish billing first\""],
    help: [PROPOSALS_HELP],
    run: proposalsDecline,
  },
  {
    name: "say",
    usage: SAY_USAGE,
    summary: "Write to the Lead, or answer one of its open questions with --answer",
    flags: {
      "--answer": { value: true, description: "id of the Lead's open question this answers (see `nico-agent lead log`)" },
      "--raw": { value: true, description: "what the transcription service heard, when the message or answer was spoken; kept on the entry" },
    },
    positionals: ["text..."],
    examples: [
      "nico-agent say \"Finish acme/api#12 before starting the billing Spec\"",
      "nico-agent say --answer 4 \"Yes, close it\"",
      "nico-agent say --json -- \"--force is fine here\"",
      "nico-agent say --raw \"dispatch acme api twelve\" -- \"Dispatch acme/api#12\"",
    ],
    help: [
      "The Lead is Nudged to read its Inbox: now if it is idle, else by `nico-agent serve` once it is",
      "A message starting \"No, I said\" supersedes your last one; the Lead reads it as a correction",
      LOG_HELP,
    ],
    run: sayCommand,
  },
  {
    name: "lead inbox",
    usage: "nico-agent lead inbox",
    summary: "Read the Lead's Inbox: the entries it has not seen, each returned once, with the orient packet (its MCP `inbox` tool)",
    help: ["This moves the Lead's cursor, so the Lead will not see what it returns; run `nico-agent lead log` to read the conversation instead"],
    flags: {},
    positionals: [],
    examples: ["nico-agent lead inbox --json"],
    run: leadInboxCommand,
  },
  {
    name: "lead say",
    usage: LEAD_SAY_USAGE,
    summary: "Write the Lead's reply into the conversation (its MCP `say` tool)",
    flags: {},
    positionals: ["text..."],
    examples: ["nico-agent lead say \"Two Specs are running; acme/api#7 waits on you\""],
    help: [LOG_HELP],
    run: leadSayCommand,
  },
  {
    name: "lead ask",
    usage: LEAD_ASK_USAGE,
    summary: "Ask the user a question for the Lead, with optional choices; it stays open until answered (its MCP `ask` tool)",
    flags: {},
    positionals: ["question", "choice..."],
    examples: ["nico-agent lead ask \"Close acme/api#7?\" yes no", "nico-agent lead ask --json -- \"Which base?\" main beta"],
    help: [LOG_HELP],
    run: leadAskCommand,
  },
  {
    name: "lead log",
    usage: "nico-agent lead log",
    summary: "Show the conversation with the Lead, oldest first, with who said what and when (read-only)",
    flags: {},
    positionals: [],
    examples: ["nico-agent lead log", "nico-agent lead log --json"],
    run: leadLogCommand,
  },
  {
    name: "lead recall",
    usage: RECALL_USAGE,
    summary: "Search the whole conversation with the Lead for text, optionally within a time range (its MCP `recall` tool)",
    flags: {
      "--since": { value: true, description: "only entries from this date or time on, e.g. 2026-09-01" },
      "--until": { value: true, description: "only entries up to this date (through its end) or time, e.g. 2026-09-30" },
    },
    positionals: ["query..."],
    examples: ["nico-agent lead recall billing", "nico-agent lead recall \"Stripe contract\" --since 2026-09-01 --json"],
    run: leadRecallCommand,
  },
  {
    name: "lead propose",
    usage: PROPOSE_USAGE,
    summary: "Propose an action, or Markdown to write to a Repo's Source, for the user to approve or decline, as the Lead (its MCP `propose` tool)",
    flags: {
      "--reason": { value: true, description: "why, in a sentence the user can decide on (required)" },
      "--write": { value: true, description: "propose writing Markdown to this Repo's Source instead of a command; approving lets the Lead write it" },
      "--file": { value: true, description: "with --write: the Markdown file to write (default: standard input)" },
      "--text": { value: true, description: "with --write: the Markdown to write, instead of a file" },
    },
    positionals: ["command..."],
    examples: [
      "nico-agent lead propose --reason \"Smallest unblocked Spec\" -- queue --repo acme/api -- acme/api#10",
      "nico-agent lead propose --reason \"The billing Spec we agreed on\" --write acme/api --file spec.md",
    ],
    help: [`A Proposal runs one of: ${PROPOSABLE.join(", ")}; or, with --write, lets the Lead write Markdown to a Repo's Source`],
    run: leadProposeCommand,
  },
  {
    name: "github usage",
    usage: GITHUB_USAGE_USAGE,
    summary: "Count nico-agent's own GitHub calls of the last hour and 24 hours by caller and by query, with the busiest minute, the failures and the account's remaining quota",
    flags: { "--since": { value: true, description: "count the calls from this date or time on instead, e.g. 2026-10-09T15:00:00Z" } },
    positionals: [],
    examples: ["nico-agent github usage", "nico-agent github usage --since 2026-10-09T15:00:00Z --json"],
    help: ["The account's spend beyond nico-agent's calls is everyone else on it: Implementers, Reviewers, the Lead"],
    run: githubUsageCommand,
  },
  {
    name: "stats",
    usage: STATS_USAGE,
    summary: "Count PRs merged and issues defined per day, per Repo and in total, from what nico-agent already saw (no GitHub call)",
    flags: {
      "--days": { value: true, description: "how many days up to today to count (default 30)" },
      "--repo": { value: true, description: "count only this Repo, e.g. acme/api" },
    },
    positionals: [],
    examples: ["nico-agent stats", "nico-agent stats --days 7 --repo acme/api --json"],
    help: [
      "An issue is defined on the day the Board first lists it as Ready; those a Repo's first read finds were defined before, and are not counted",
      "A day before nico-agent saw any PR event, or before it first read a Repo's issues, is no data (null), not zero; days are UTC",
    ],
    run: statsCommand,
  },
  {
    name: "harness list",
    usage: "nico-agent harness list",
    summary: "List the Harnesses with their models and Effort levels (discovers uncached ones)",
    flags: {},
    positionals: [],
    examples: ["nico-agent harness list", "nico-agent harness list --json"],
    run: (args, ctx) => harnessList(ctx, args.flags["--json"] === true),
  },
  {
    name: "harness refresh",
    usage: "nico-agent harness refresh",
    summary: "Discover the Harnesses' models and Effort levels again and replace the cache",
    flags: {},
    positionals: [],
    examples: ["nico-agent harness refresh"],
    run: (_args, ctx) => harnessRefresh(ctx),
  },
  {
    name: "show",
    usage: "nico-agent show <issue>",
    summary: "Print the full Dispatch record of an In-flight issue",
    flags: {},
    positionals: ["issue"],
    examples: ["nico-agent show acme/api#7", "nico-agent show https://github.com/acme/api/issues/7 --json"],
    run: show,
  },
  {
    name: "garden",
    usage: GARDEN_USAGE,
    summary: "Start the Repo's Gardener: an agent that rebases, retargets and resolves conflicts in its open PRs, never merging (no-op while one runs)",
    flags: { "--pr": { value: true, repeats: true, description: "an open PR of the Repo to tend, by URL; repeat for several (default: every one that needs it)" } },
    positionals: ["repo"],
    examples: ["nico-agent garden acme/api", "nico-agent garden acme/api --pr https://github.com/acme/api/pull/12 --pr https://github.com/acme/api/pull/13"],
    help: [
      "It runs on the gardener launch in config (default opencode2 opencode-go/deepseek-v4.1-flash max), with the garden prompt",
      "A PR whose PR below it merged is rebased onto its new base and retargeted; any other is treated as conflicting",
      "Its workspace is removed once it is done, on the next `nico-agent advance`",
    ],
    run: gardenCommand,
  },
  {
    name: "lead start",
    usage: LEAD_START_USAGE,
    summary: "Start the Lead as the herdr agent `lead` in its own workspace, connected to serve's MCP server (no-op while it runs)",
    flags: {
      "--harness": { value: true, description: "Harness to run the Lead on (default: lead.harness in config)" },
      "--model": { value: true, description: "model for the Harness (default: lead.model in config)" },
      "--effort": { value: true, description: "Effort level for the Harness (default: lead.effort in config)" },
      "--port": { value: true, description: "port `nico-agent serve` listens on (default 42069)" },
    },
    positionals: [],
    examples: ["nico-agent lead start", "nico-agent lead start --harness codex --model gpt-5.5 --effort high"],
    help: ["A different launch than the running Lead's stops it and starts the new one; the conversation is kept"],
    run: leadStartCommand,
  },
  {
    name: "lead status",
    usage: "nico-agent lead status",
    summary: "Show whether the Lead runs, in which workspace, on which Harness, model and Effort, and its Agent state",
    flags: {},
    positionals: [],
    examples: ["nico-agent lead status", "nico-agent lead status --json"],
    run: (_args, ctx) => leadStatusCommand(ctx),
  },
  {
    name: "lead stop",
    usage: "nico-agent lead stop",
    summary: "Close the Lead's workspace and forget it, keeping its home and the conversation",
    flags: {},
    positionals: [],
    examples: ["nico-agent lead stop"],
    run: (_args, ctx) => leadStopCommand(ctx),
  },
  {
    name: "voice check",
    usage: "nico-agent voice check",
    summary: "Send each configured voice service a short sample and report whether it answered, what it returned and how long it took",
    flags: {},
    positionals: [],
    examples: ["nico-agent voice check", "nico-agent voice check --json"],
    help: [VOICE_DOCS_HELP],
    run: (_args, ctx) => voiceCheckCommand(ctx),
  },
  {
    name: "voice talk",
    usage: VOICE_TALK_USAGE,
    summary: "Start the open app's talk button hands-free, as a tap would: bind it to a key to talk from anywhere; again, it sends what was said, or ends the session",
    flags: { "--port": { value: true, description: "port `nico-agent serve` listens on (default 42069)" } },
    positionals: [],
    examples: ["nico-agent voice talk", "nico-agent voice talk --port 8080"],
    help: [`See ${VOICE_DOC} for the Hyprland binding`],
    run: voiceTalk,
  },
  {
    name: "voice",
    usage: "nico-agent voice",
    summary: "Show whether Voice is on: the Lead's replies spoken in the app, and the Lead talking for the ear",
    flags: {},
    positionals: [],
    examples: ["nico-agent voice", "nico-agent voice --json"],
    help: [VOICE_ON_HELP],
    run: (_args, ctx) => voiceCommand(ctx),
  },
  ...(["on", "off"] as const).map((state): Command => ({
    name: `voice ${state}`,
    usage: `nico-agent voice ${state}`,
    summary: state === "on"
      ? "Turn Voice on: the app speaks the Lead's replies, and its Nudge tells the Lead to talk for the ear"
      : "Turn Voice off: the Lead's replies are only shown, written for the eye",
    flags: {},
    positionals: [],
    examples: [`nico-agent voice ${state}`],
    help: [VOICE_ON_HELP],
    run: (_args, ctx) => voiceSet(ctx, state === "on"),
  })),
  {
    name: "serve",
    usage: "nico-agent serve [--port <port>]",
    summary: "Start the web app and its MCP server (/mcp) on 127.0.0.1 (port 42069 by default)",
    flags: { "--port": { value: true, description: "port to listen on (default 42069)" } },
    positionals: [],
    examples: ["nico-agent serve", "nico-agent serve --port 8080"],
    run: serve,
  },
];

export async function run(argv: string[], ctx: RunContext): Promise<RunResult> {
  if (argv.length === 1 && ["-v", "-V", "--version"].includes(argv[0]!)) {
    return { stdout: `${VERSION}\n`, exitCode: 0 };
  }
  // After `--`, every token is an argument, `--json` included.
  const end = argv.indexOf("--");
  const json = (end === -1 ? argv : argv.slice(0, end)).includes("--json");
  try {
    const { command, rest } = findCommand(argv);
    const args = parseArgs(command, rest);
    const topLevel = argv[0]?.startsWith("-") ?? true;
    const output = !args.flags["--help"]
      ? await commandCaller(command, () => command.run(args, ctx))
      : topLevel
        ? topLevelHelp(ctx)
        : commandHelp(command);
    return { stdout: render(output, json), exitCode: output.exitCode ?? 0 };
  } catch (e) {
    if (e instanceof ConfigError) e = new CliError(e.message, [e.help]);
    else if (e instanceof WorldError) e = new CliError(e.message);
    else if (e instanceof DispatchError) {
      const details = e instanceof StepFailed ? { stage: stageOf(e.dispatch, null) } : {};
      e = new CliError(e.message, e.help, e.usage ? 2 : 1, details);
    }
    if (!(e instanceof CliError)) throw e;
    const output = { data: { error: e.message, ...e.details }, help: e.help };
    return { stdout: render(output, json), exitCode: e.exitCode };
  }
}

/**
 * Run a command with its GitHub calls logged under its name: the Board, and
 * `advance` as the Scheduler. `serve` sets none, so its ticks and requests name their own.
 */
function commandCaller<T>(command: Command, body: () => Promise<T>): Promise<T> {
  if (command.name === "serve") return body();
  const caller = command.name === "board" ? "board" : command.name === "advance" ? "scheduler" : `cli ${command.name}`;
  return withCaller(caller, body);
}

function findCommand(argv: string[]): { command: Command; rest: string[] } {
  const words: string[] = [];
  for (const token of argv) {
    if (token.startsWith("-")) break;
    words.push(token);
  }
  if (words.length === 0) return { command: commands[0]!, rest: argv };
  for (const size of [2, 1]) {
    if (words.length < size) continue;
    const name = words.slice(0, size).join(" ");
    const command = commands.find((c) => c.name === name);
    if (command) return { command, rest: argv.slice(size) };
  }
  const group = commands.filter((c) => c.name.startsWith(`${words[0]} `));
  if (group.length) {
    throw new CliError(
      words[1] ? `unknown command \`${words[0]} ${words[1]}\`` : `\`${words[0]}\` needs a subcommand`,
      group.map((c) => `Run \`${c.usage}\` to ${lowerFirst(c.summary)}`),
      2,
    );
  }
  throw new CliError(
    `unknown command \`${words[0]}\``,
    commands.map((c) => `Run \`${c.usage}\` to ${lowerFirst(c.summary)}`),
    2,
  );
}

function parseArgs(command: Command, tokens: string[]): Args {
  const known = { ...command.flags, ...GLOBAL_FLAGS };
  const args: Args = { positionals: [], flags: {} };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === "--") {
      args.positionals.push(...tokens.slice(i + 1));
      break;
    }
    if (!token.startsWith("-")) {
      args.positionals.push(token);
      continue;
    }
    const [name, inline] = token.split(/=(.*)/s) as [string, string | undefined];
    const spec = known[name as keyof typeof known];
    if (!spec) {
      throw new CliError(`unknown flag ${name} for \`${command.name}\``, [validFlagsHelp(command)], 2);
    }
    if (!spec.value) {
      args.flags[name] = true;
      continue;
    }
    const value = inline ?? tokens[++i];
    if (value === undefined || value === "") {
      throw new CliError(`${name} needs a value`, [`Usage: \`${command.usage}\``], 2);
    }
    const given = args.flags[name];
    args.flags[name] = "repeats" in spec && spec.repeats ? [...(Array.isArray(given) ? given : []), value] : value;
  }
  if (args.flags["--help"]) return args;
  const variadic = command.positionals.at(-1)?.endsWith("...");
  if (!variadic && args.positionals.length > command.positionals.length) {
    const extra = args.positionals[command.positionals.length];
    throw new CliError(`unexpected argument \`${extra}\` for \`${command.name}\``, [`Usage: \`${command.usage}\``], 2);
  }
  return args;
}

function validFlagsHelp(command: Command) {
  const flags = [...Object.keys(command.flags), ...Object.keys(GLOBAL_FLAGS)];
  return `Valid flags for \`${command.name}\`: ${flags.join(", ")}`;
}

function topLevelHelp(ctx: RunContext): Output {
  return {
    data: {
      bin: ctx.bin,
      description: DESCRIPTION,
      commands: commands.map((c) => ({ usage: c.usage, description: c.summary })),
    },
    help: ["Run `nico-agent <command> --help` for its flags and examples"],
  };
}

function commandHelp(command: Command): Output {
  const flags = { ...command.flags, ...GLOBAL_FLAGS };
  return {
    data: {
      usage: command.usage,
      description: command.summary,
      flags: Object.entries(flags).map(([flag, spec]) => ({
        flag: spec.value ? `${flag} <value>` : flag,
        description: spec.description,
      })),
      examples: command.examples,
    },
    help: command.help,
  };
}

function required(args: Args, flag: string, usage: string) {
  const value = args.flags[flag];
  if (typeof value !== "string") throw new CliError(`missing required flag ${flag}`, [`Usage: \`${usage}\``], 2);
  return value;
}

function launchFlags(args: Args, usage: string) {
  return {
    harness: required(args, "--harness", usage),
    model: required(args, "--model", usage),
    effort: required(args, "--effort", usage),
  };
}

function issueArg(args: Args, usage: string) {
  const issue = args.positionals[0];
  if (!issue) throw new CliError("<issue> is required", [`Usage: \`${usage}\``], 2);
  return issue;
}

/** One issue's part of a command run on several: its Dispatch key, result and Stage. */
interface IssueRun {
  output: Output;
  issue: string;
  result: string;
  stage?: string;
}

/**
 * Run a command on each issue given. A single issue gets the command's own
 * output and errors; several get a row each and exit 1 if any failed or was
 * skipped (`verb` names the count of those done). `withStage` adds a Stage
 * column.
 */
async function onIssues(args: Args, usage: string, verb: string, withStage: boolean, one: (issue: string) => Promise<IssueRun>): Promise<Output> {
  const issues = args.positionals;
  if (issues.length <= 1) return (await one(issueArg(args, usage))).output;
  const outcomes = await eachIssue(issues, one);
  const rows = outcomes.map((o) => {
    if (o.outcome === "done") {
      const { issue, result, stage = "" } = o.value;
      return { issue, result, ...(withStage && { stage }), error: "" };
    }
    const stage = o.error instanceof StepFailed ? stageOf(o.error.dispatch, null) : "";
    return { issue: o.issue, result: o.outcome, ...(withStage && { stage }), error: o.error.message };
  });
  const help = outcomes.flatMap((o) => (o.outcome === "done" ? [] : o.error instanceof DispatchError ? o.error.help : []));
  help.push(...outcomes.flatMap((o) => (o.outcome === "done" ? (o.value.output.help ?? []) : [])));
  const done = outcomes.filter((o) => o.outcome === "done").length;
  return {
    data: { [verb]: `${done} of ${plural(issues.length, "issue")}`, results: rows },
    help: [...new Set([...help, BOARD_HELP])],
    exitCode: done === issues.length ? 0 : 1,
  };
}

async function dispatchCommand(args: Args, ctx: RunContext): Promise<Output> {
  const flags = launchFlags(args, DISPATCH_USAGE);
  const { "--stack-on": stackOn, "--base": base, "--repo": repo } = args.flags;
  return onIssues(args, DISPATCH_USAGE, "dispatched", true, async (issue) => {
    const { dispatch: record, outcome, resumedFrom } = await dispatch(ctx.world, ctx.configDir, {
      issue,
      ...flags,
      ...(typeof stackOn === "string" && { stackOn }),
      ...(typeof base === "string" && { base }),
      ...(typeof repo === "string" && { repo }),
    });
    // A Dispatch just run has no PR yet; an existing one may.
    const stage = outcome === "existing" ? await currentStage(ctx.world, record) : stageOf(record, null);
    const result = {
      new: "dispatched",
      existing: "already In flight (no-op)",
      resumed: `resumed from ${resumedFrom}`,
    }[outcome];
    const help = [`Run \`nico-agent show ${record.issue}\` to see the Dispatch`, BOARD_HELP];
    const source = linearIdentifier(record.issue) ? "Linear" : "GitHub";
    if (record.claimed === false) help.unshift(`Assign ${record.url} to yourself on ${source} to Claim it by hand`);
    const data = {
      dispatched: outcome === "resumed" ? `${record.issue} (${result})` : outcome === "new" ? record.issue : `${record.issue} ${result}`,
      stage,
      workspace: record.workspace,
      agent: record.implementer.agent,
      ...(record.warnings && { warnings: record.warnings }),
    };
    return { output: { data, help }, issue: record.issue, result, stage };
  });
}

async function advanceCommand(_args: Args, ctx: RunContext): Promise<Output> {
  return advanceOutput(await advance(ctx.world, ctx.configDir));
}

function advanceOutput({ specs, errors, closed, gardeners, warnings, help }: AdvanceReport): Output {
  return {
    data: { specs, ...(errors.length && { errors }), ...(closed.length && { closed }), ...(gardeners.length && { gardeners }), ...(warnings.length && { warnings }) },
    help: [...help, BOARD_HELP],
    exitCode: errors.length || specs.some((s) => s.result === "failed") ? 1 : 0,
  };
}

/** The Spec and the configured Repo a Queue command names. */
function queueArgs(args: Args, ctx: RunContext, usage: string) {
  const spec = args.positionals[0];
  if (!spec) throw new CliError("<spec> is required", [`Usage: \`${usage}\``], 2);
  const slug = required(args, "--repo", usage);
  const repo = findRepo(loadConfig(ctx.configDir), slug);
  if (!repo) throw new CliError(`${slug} is not a configured Repo`, ["Run `nico-agent repo list` to see the Repos"]);
  return { spec, repo };
}

/** A Queue command's answer: what happened to the Spec, its place if queued, and the Queue head first. */
function queueOutput(spec: string, queue: string[], summary: Record<string, string>, help: string[] = []): Output {
  const place = queue.findIndex((s) => sameSpec(s, spec));
  return {
    data: { ...summary, ...(place >= 0 && { place: `${place + 1} of ${queue.length}` }), queue },
    help: [...help, BOARD_HELP],
  };
}

/** `spec` as `repo`'s Queue spells it, whatever case it was typed in; unqueued, as typed. */
function queuedName(ctx: RunContext, repo: string, spec: string) {
  return queueOf(loadQueues(ctx.configDir), repo).find((s) => sameSpec(s, spec)) ?? spec;
}

async function queueCommand(args: Args, ctx: RunContext): Promise<Output> {
  const { spec, repo } = queueArgs(args, ctx, QUEUE_USAGE);
  const board = await loadBoard(ctx.world, [repo], loadDispatches(ctx.configDir), ctx.prs ?? cachedPrs(ctx.world));
  await recordSighting(ctx.configDir, board.sighting, ctx.world.now());
  const decision = board.specs.find((d) => sameSlug(d.repo, repo.slug));
  if (!decision || !isCandidate(decision, spec)) {
    throw new CliError(`${spec} is not a candidate Spec of ${repo.slug}`, [
      "Only a candidate Spec, not started, not Held and with a Ready first issue, can be queued",
      "Run `nico-agent --json` to see each Repo's candidates under `rooms`",
    ]);
  }
  // Queued as the Board names it, so the Queue reads the same everywhere.
  const name = decision.specs.find((s) => sameSpec(s.spec, spec))!.spec;
  const { queue, changed } = await enqueue(ctx.configDir, repo.slug, name);
  const help = queue.findIndex((s) => sameSpec(s, name)) > 0 ? [`Run \`nico-agent move ${name} up --repo ${repo.slug}\` to start it sooner`] : [];
  return queueOutput(name, queue, { queued: changed ? name : `${name} already queued (no-op)` }, help);
}

async function unqueueCommand(args: Args, ctx: RunContext): Promise<Output> {
  const { spec, repo } = queueArgs(args, ctx, UNQUEUE_USAGE);
  const name = queuedName(ctx, repo.slug, spec);
  const { queue, changed } = await dequeue(ctx.configDir, repo.slug, name);
  return queueOutput(name, queue, { unqueued: changed ? name : `${name} not queued (no-op)` });
}

async function moveCommand(args: Args, ctx: RunContext): Promise<Output> {
  const { spec, repo } = queueArgs(args, ctx, MOVE_USAGE);
  const direction = args.positionals[1];
  if (direction !== "up" && direction !== "down") {
    throw new CliError(direction ? `\`${direction}\` is not a direction; move a queued Spec \`up\` or \`down\`` : "<up|down> is required", [`Usage: \`${MOVE_USAGE}\``], 2);
  }
  const name = queuedName(ctx, repo.slug, spec);
  if (!queueOf(loadQueues(ctx.configDir), repo.slug).some((s) => sameSpec(s, name))) {
    throw new CliError(`${name} is not queued in ${repo.slug}`, [`Run \`nico-agent queue ${name} --repo ${repo.slug}\` to queue it`]);
  }
  const { queue, changed } = await move(ctx.configDir, repo.slug, name, direction);
  const end = direction === "up" ? "head" : "tail";
  return queueOutput(name, queue, { moved: changed ? `${name} ${direction}` : `${name} already at the ${end} (no-op)` });
}

async function answerCommand(args: Args, ctx: RunContext): Promise<Output> {
  const [issue, ...words] = args.positionals;
  const text = words.join(" ");
  if (!issue || !text) throw new CliError(issue ? "<text> is required" : "<issue> is required", [`Usage: \`${ANSWER_USAGE}\``], 2);
  const { answered, agent, gardener, started } = await answer(ctx.world, ctx.configDir, issue, text);
  const help = [gardener ? `Run \`herdr agent read ${agent}\` to see the Gardener` : `Run \`nico-agent show ${answered}\` to see the Dispatch`, BOARD_HELP];
  if (!started) help.unshift(`Run \`herdr agent read ${agent}\` to see whether it took the answer`);
  const who = gardener ? "Gardener" : "Implementer";
  return {
    data: { answered, agent, ...(!started && { warning: `the answer was submitted, but the ${who} has not started working` }) },
    help,
  };
}

async function peekCommand(args: Args, ctx: RunContext): Promise<Output> {
  const [issue] = args.positionals;
  const reviewer = args.flags["--reviewer"] === true;
  if (reviewer && !issue) throw new CliError("--reviewer needs an <issue>", [`Usage: \`${PEEK_USAGE}\``], 2);
  const peeked = await peek(ctx.world, ctx.configDir, issue, reviewer);
  const help = peeked.issue ? [`Run \`nico-agent show ${peeked.issue}\` to see the Dispatch`, BOARD_HELP] : [LEAD_STATUS_HELP];
  return { data: { ...peeked }, help };
}

async function sayCommand(args: Args, ctx: RunContext): Promise<Output> {
  const text = args.positionals.join(" ");
  if (!text.trim()) throw new CliError("<text> is required", [`Usage: \`${SAY_USAGE}\``], 2);
  const { "--answer": flag, "--raw": raw } = args.flags;
  let data: Record<string, unknown>;
  if (typeof flag !== "string") {
    const entry = await sayToLead(ctx.configDir, { text, ...(typeof raw === "string" && { raw }) }, ctx.world.now());
    data = { said: entry.id, ...(entry.supersedes !== undefined && { supersedes: entry.supersedes }) };
  } else {
    try {
      const answer = await answerQuestion(ctx.configDir, flag, text, ctx.world.now(), typeof raw === "string" ? raw : undefined);
      data = { answered: answer.question, id: answer.id };
    } catch (e) {
      if (!(e instanceof AnswerRefused)) throw e;
      const open = e.open.length ? `the open ones are ${e.open.join(", ")}` : "none is open";
      throw new CliError(e.message, [`Run \`nico-agent lead log\` to see the Lead's questions (${open})`]);
    }
  }
  const warnings = await nudgeLead(ctx.world, ctx.configDir);
  return { data: { ...data, ...(warnings.length && { warnings }) }, help: [LOG_HELP] };
}

async function leadInboxCommand(_args: Args, ctx: RunContext): Promise<Output> {
  const { entries, orient } = await readInbox(ctx.configDir);
  const help = [`Run \`${LEAD_SAY_USAGE}\` to reply`, `Run \`${LEAD_ASK_USAGE}\` to ask the user`];
  return { data: { inbox: plural(entries.length, "new entry", "new entries"), entries, orient }, help };
}

async function leadSayCommand(args: Args, ctx: RunContext): Promise<Output> {
  const text = args.positionals.join(" ");
  if (!text.trim()) throw new CliError("<text> is required", [`Usage: \`${LEAD_SAY_USAGE}\``], 2);
  const entry = await append(ctx.configDir, { type: "lead", text }, ctx.world.now());
  return { data: { said: entry.id }, help: [LOG_HELP] };
}

async function leadAskCommand(args: Args, ctx: RunContext): Promise<Output> {
  const [text, ...choices] = args.positionals;
  if (!text?.trim()) throw new CliError("<question> is required", [`Usage: \`${LEAD_ASK_USAGE}\``], 2);
  const entry = await append(ctx.configDir, { type: "ask", text, ...(choices.length && { choices }) }, ctx.world.now());
  const open = openAsks(loadConversation(ctx.configDir));
  const warnings = await notifyOnce(ctx.world, ctx.configDir, open.map(askNotice), (scope) => scope === ASKS_SCOPE);
  return { data: { asked: entry.id, ...(warnings.length && { warnings }) }, help: [`The answer arrives in the Inbox naming question ${entry.id}`, LOG_HELP] };
}

/** A new question from the Lead, in its own words, for the user away from the Board. */
function askNotice(ask: Ask) {
  const choices = ask.choices?.length ? ` (${ask.choices.join(" / ")})` : "";
  return {
    key: `ask ${ask.id}`,
    scope: ASKS_SCOPE,
    title: "The Lead asks",
    body: `${ask.text}${choices}\nRun \`nico-agent say --answer ${ask.id} <answer>\` to answer`,
  };
}

async function leadRecallCommand(args: Args, ctx: RunContext): Promise<Output> {
  const query = args.positionals.join(" ");
  if (!query.trim()) throw new CliError("<query> is required", [`Usage: \`${RECALL_USAGE}\``], 2);
  const since = timeFlag(args, "--since", RECALL_USAGE);
  const until = timeFlag(args, "--until", RECALL_USAGE);
  const entries = recall(loadConversation(ctx.configDir), query, { since, until });
  const help = entries.length ? [LOG_HELP] : ["Try another word, or a wider time range", LOG_HELP];
  return { data: { recall: `${plural(entries.length, "entry matches", "entries match")} ${JSON.stringify(query)}`, entries }, help };
}

/** The time `flag` names; a bare date `--until` runs to the end of that day (UTC). */
function timeFlag(args: Args, flag: "--since" | "--until", usage: string): Date | undefined {
  const value = args.flags[flag];
  if (typeof value !== "string") return undefined;
  const time = new Date(flag === "--until" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value);
  if (Number.isNaN(time.getTime())) {
    throw new CliError(`${flag} must be a date or time such as 2026-09-01 or 2026-09-01T12:00:00Z (got \`${value}\`)`, [`Usage: \`${usage}\``], 2);
  }
  return time;
}

async function githubUsageCommand(args: Args, ctx: RunContext): Promise<Output> {
  const since = timeFlag(args, "--since", GITHUB_USAGE_USAGE);
  // Read before asking for the quota, so the last call is the last one before this command.
  const calls = readGitHubCalls(resolve(ctx.configDir, GITHUB_CALLS_FILE));
  const quota = await ctx.world.githubRateLimit().catch((e) => worldErrorMessage(e));
  const help = [since ? "Run `nico-agent github usage` for the last hour and 24 hours" : "Run `nico-agent github usage --since <time>` to count from another time"];
  return { data: githubUsage(calls, ctx.world.now(), quota, since), help };
}

async function statsCommand(args: Args, ctx: RunContext): Promise<Output> {
  const daysFlag = args.flags["--days"];
  const days = typeof daysFlag === "string" ? Number(daysFlag) : 30;
  if (!Number.isInteger(days) || days < 1 || days > 366) {
    throw new CliError(`--days must be a whole number from 1 to 366 (got \`${daysFlag}\`)`, [`Usage: \`${STATS_USAGE}\``], 2);
  }
  const repoFlag = args.flags["--repo"];
  if (repoFlag !== undefined && (typeof repoFlag !== "string" || !isSlug(repoFlag))) {
    throw new CliError(`--repo must be an owner/name such as acme/api (got \`${repoFlag}\`)`, [`Usage: \`${STATS_USAGE}\``], 2);
  }
  const repos = loadConfig(ctx.configDir).repos.map((r) => r.slug);
  let data;
  try {
    data = stats(ctx.configDir, loadConversation(ctx.configDir), { now: ctx.world.now(), days, repos, ...(repoFlag && { repo: repoFlag }) });
  } catch (e) {
    if (e instanceof UnknownRepo) throw new CliError(e.message, ["Run `nico-agent repo list` to see the Repos"]);
    throw e;
  }
  const help = [
    repoFlag ? "Run `nico-agent stats` to count every Repo" : "Run `nico-agent stats --repo <owner/name>` to count one Repo",
    "Run `nico-agent stats --days <n>` to count another number of days",
  ];
  return { data: { ...data }, help };
}

async function leadLogCommand(_args: Args, ctx: RunContext): Promise<Output> {
  const conversation = loadConversation(ctx.configDir);
  const entries = conversation.map(authored);
  const open = openQuestions(conversation);
  const help = [`Run \`${SAY_USAGE}\` to write to the Lead`];
  if (open.length) help.unshift(`Run \`nico-agent say --answer <id> <text>\` to answer the Lead's open questions (${open.join(", ")})`);
  return { data: { log: plural(entries.length, "entry", "entries"), entries }, help };
}

async function leadProposeCommand(args: Args, ctx: RunContext): Promise<Output> {
  const reason = required(args, "--reason", PROPOSE_USAGE);
  if (!reason.trim()) throw new CliError("--reason needs a value", [`Usage: \`${PROPOSE_USAGE}\``], 2);
  const proposed = typeof args.flags["--write"] === "string" ? await proposedWrite(args, ctx) : proposedAction(args);
  const proposal = await addProposal(ctx.configDir, proposed, reason, ctx.world.now());
  const open = openProposals(ctx.configDir);
  const warnings = await notifyOnce(ctx.world, ctx.configDir, open.map(proposalNotice), (scope) => scope === PROPOSALS_SCOPE);
  return {
    data: { proposed: proposal.id, ...describeProposed(proposed).summary, ...(warnings.length && { warnings }) },
    help: [`The user approves or declines it with \`nico-agent proposals\`; the decision arrives in your Inbox naming Proposal ${proposal.id}`],
  };
}

/** `--write`'s Proposal: the Markdown for a configured Repo's Source, never blank. */
async function proposedWrite(args: Args, ctx: RunContext): Promise<Proposed> {
  const slug = args.flags["--write"] as string;
  if (args.positionals.length) throw new CliError("a Proposal runs a command or writes to a Source, not both", [`Usage: \`${PROPOSE_USAGE}\``], 2);
  const repo = findRepo(loadConfig(ctx.configDir), slug);
  if (!repo) throw new CliError(`${slug} is not a configured Repo`, ["Run `nico-agent repo list` to see the Repos"]);
  const { "--file": file, "--text": inline } = args.flags;
  if (typeof file === "string" && typeof inline === "string") throw new CliError("--file and --text give the Markdown two ways; pass one", [`Usage: \`${PROPOSE_USAGE}\``], 2);
  const text = typeof inline === "string" ? inline : typeof file === "string" ? readMarkdown(file) : await readStdin(ctx, PROPOSE_USAGE, "nothing to write: pass --file or --text, or pipe the Markdown in");
  if (!text.trim()) throw new CliError("the Markdown to write is empty", ["Pass the Markdown as --text, --file or standard input"], 2);
  return { write: { repo: repo.slug, text } };
}

/** A command line as a Proposal runs it, checked now so the user is never asked to approve one that cannot run. */
function proposedAction(args: Args): Proposed {
  if (args.flags["--file"] !== undefined || args.flags["--text"] !== undefined) {
    throw new CliError("--file and --text go with --write", [`Usage: \`${PROPOSE_USAGE}\``], 2);
  }
  const action = args.positionals;
  const command = commands.find((c) => c.name === action[0] && PROPOSABLE.includes(c.name));
  if (!command) {
    throw new CliError(action[0] ? `\`${action[0]}\` is not an action a Proposal can run` : "<command> is required", [
      `A Proposal runs one of: ${PROPOSABLE.join(", ")}`,
      `Usage: \`${PROPOSE_USAGE}\``,
    ], 2);
  }
  // Checked now, so the user is never asked to approve a command line that cannot run.
  try {
    if (parseArgs(command, action.slice(1)).flags["--help"]) throw new CliError("--help shows help; it is not an action", [], 2);
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    throw new CliError(`the action is not a valid \`${command.name}\` command: ${e.message}`, [`Usage: \`${command.usage}\``], 2);
  }
  return { action };
}

/** A new Proposal, for the user away from the Board. */
function proposalNotice(proposal: Proposal) {
  const { id, reason } = proposal;
  const decline = `\`nico-agent proposals decline ${id} [reason]\``;
  return {
    key: `proposal ${id}`,
    scope: PROPOSALS_SCOPE,
    ...("action" in proposal
      ? { title: `The Lead proposes: ${commandLine(proposal.action)}`, body: `${reason}\nRun \`nico-agent proposals approve ${id}\` to run it, or ${decline}` }
      : {
          title: `The Lead proposes to ${describeProposed(proposal).line}`,
          body: `${reason}\nRun \`nico-agent proposals\` to read it, then \`nico-agent proposals approve ${id}\` to have the Lead write it, or ${decline}`,
        }),
  };
}

async function proposalsList(args: Args, ctx: RunContext): Promise<Output> {
  const proposals = loadProposals(ctx.configDir);
  const open = openProposals(ctx.configDir);
  const help = open.length
    ? [`Run \`nico-agent proposals approve ${open[0]!.id}\` to run one, or \`nico-agent proposals decline ${open[0]!.id} [reason]\` to turn it down`]
    : [];
  if (args.flags["--all"] === true) {
    const rows = proposals.map((p) => {
      const { proposed, shown } = describeProposed(p);
      const decided = Object.fromEntries(Object.entries(p).filter(([key]) => !(key in proposed)));
      return { ...decided, ...shown };
    });
    return { data: { proposals: rows }, help: [...help, LOG_HELP] };
  }
  const rows = open.map((p) => ({ id: p.id, at: p.at, ...describeProposed(p).shown, reason: p.reason }));
  return { data: { proposals: `${open.length} open`, open: rows }, help: [...help, "Run `nico-agent proposals --all` to see decided ones too"] };
}

/** Decide Proposal `id`, turning a refusal into the CLI's own. */
async function decideProposal(ctx: RunContext, id: string, status: "approved" | "declined", declineReason?: string) {
  try {
    return await decide(ctx.configDir, id, status, ctx.world.now(), declineReason);
  } catch (e) {
    if (!(e instanceof ProposalRefused)) throw e;
    const open = e.open.length ? `the open ones are ${e.open.join(", ")}` : "none is open";
    throw new CliError(e.message, [`Run \`nico-agent proposals --all\` to see every Proposal (${open})`]);
  }
}

function idArg(args: Args, usage: string) {
  const id = args.positionals[0];
  if (!id) throw new CliError("<id> is required", [`Usage: \`${usage}\``, PROPOSALS_HELP], 2);
  return id;
}

/**
 * Run an approved Proposal's action as the CLI command it is. An action
 * refused outright, or that ran nothing (every issue failed or was a
 * `(no-op)`), is no longer possible: the Proposal is closed as failed, with
 * the reason. One that ran in part is approved, exiting as the command did.
 */
async function proposalsApprove(args: Args, ctx: RunContext): Promise<Output> {
  const proposal = await decideProposal(ctx, idArg(args, APPROVE_USAGE), "approved");
  const { id } = proposal;
  if (!("action" in proposal)) return approveWrite(ctx, proposal);
  const { action, reason } = proposal;
  /** Settle the Proposal and tell the Lead, answering the Nudge's warnings. */
  const close = async (outcome: Record<string, unknown>, why: string) => {
    await settle(ctx.configDir, id, outcome, why !== "");
    await append(ctx.configDir, { type: "decision", proposal: id, decision: why ? "failed" : "approved", action, reason, text: why, outcome }, ctx.world.now());
    return nudgeLead(ctx.world, ctx.configDir);
  };
  let result: RunResult;
  try {
    result = await run(withJson(action), ctx);
  } catch (e) {
    // A bug, not a refusal; the Proposal is still closed, so the Lead hears of it.
    await close({ error: String(e) }, String(e));
    throw e;
  }
  const { help = [], ...outcome } = JSON.parse(result.stdout) as { help?: string[] } & Record<string, unknown>;
  const why = notRun(outcome);
  const warnings = await close(outcome, why);
  const nudged = warnings.length ? { warnings } : {};
  if (why) {
    throw new CliError(`Proposal ${id} is no longer possible, so it was closed as failed: ${why}`, [...help, PROPOSALS_HELP], 1, {
      proposal: id, action: commandLine(action), outcome, ...nudged,
    });
  }
  return { data: { approved: id, action: commandLine(action), outcome, ...nudged }, help: [...help, PROPOSALS_HELP], exitCode: result.exitCode === 0 ? 0 : 1 };
}

/**
 * An approved write runs nothing in nico-agent: the Lead writes it with its
 * own shell (ADR-0010), so the decision, carrying the text, goes to its Inbox.
 */
async function approveWrite(ctx: RunContext, { id, write, reason }: Proposal & { write: SourceWrite }): Promise<Output> {
  await append(ctx.configDir, { type: "decision", proposal: id, decision: "approved", write, reason, text: "" }, ctx.world.now());
  const warnings = await nudgeLead(ctx.world, ctx.configDir);
  return {
    data: { approved: id, write: write.repo, ...(warnings.length && { warnings }) },
    help: [`The Lead writes it to ${write.repo}'s Source when it reads its Inbox`, LOG_HELP],
  };
}

/** Why an action's output shows it ran nothing, or "" when it did something. */
function notRun(outcome: Record<string, unknown>): string {
  if (typeof outcome.error === "string") return outcome.error;
  // Several issues: a row each, done unless it failed, was skipped or was a no-op.
  if (Array.isArray(outcome.results)) {
    const rows = outcome.results as { issue: string; result: string; error: string }[];
    if (rows.some((r) => !r.error && !isNoOp(r.result))) return "";
    const noOps = rows.every((r) => !r.error);
    return `${noOps ? "nothing left to do: " : ""}${rows.map((r) => `${r.issue}: ${r.error || r.result}`).join("; ")}`;
  }
  const noOps = Object.values(outcome).filter((v): v is string => typeof v === "string" && isNoOp(v));
  return noOps.length ? `nothing left to do: ${noOps.join("; ")}` : "";
}

/** The CLI's word for a mutation that found it already done (ADR-0006). */
function isNoOp(result: string) {
  return result.endsWith("(no-op)");
}

async function proposalsDecline(args: Args, ctx: RunContext): Promise<Output> {
  const reason = args.positionals.slice(1).join(" ").trim();
  const proposal = await decideProposal(ctx, idArg(args, DECLINE_USAGE), "declined", reason || undefined);
  const { id } = proposal;
  await append(ctx.configDir, { type: "decision", proposal: id, decision: "declined", ...describeProposed(proposal).proposed, reason: proposal.reason, text: reason }, ctx.world.now());
  const warnings = await nudgeLead(ctx.world, ctx.configDir);
  return { data: { declined: id, ...describeProposed(proposal).summary, ...(warnings.length && { warnings }) }, help: [`The Lead reads the decision in its Inbox`, PROPOSALS_HELP] };
}

async function reviewCommand(args: Args, ctx: RunContext): Promise<Output> {
  const flags = launchFlags(args, REVIEW_USAGE);
  return onIssues(args, REVIEW_USAGE, "reviewing", true, async (issue) => {
    const { dispatch: record, outcome, resumedFrom } = await review(ctx.world, ctx.configDir, { issue, ...flags });
    const reviewer = record.reviewer!;
    const result = {
      new: "reviewing",
      existing: "already launched (no-op)",
      resumed: `resumed from ${resumedFrom}`,
    }[outcome];
    // A Reviewer just run was prompted, so the PR can't change the Stage.
    const stage = outcome === "existing" ? await currentStage(ctx.world, record) : stageOf(record, null);
    const data = {
      reviewing: outcome === "resumed" ? `${record.issue} (${result})` : outcome === "new" ? record.issue : `${record.issue} ${result}`,
      stage,
      pr: reviewer.prUrl,
      workspace: record.workspace,
      agent: reviewer.agent,
    };
    return { output: { data, help: [`Run \`nico-agent show ${record.issue}\` to see the Dispatch`, BOARD_HELP] }, issue: record.issue, result, stage };
  });
}

async function closeCommand(args: Args, ctx: RunContext): Promise<Output> {
  const confirm = args.flags["--confirm"] === true;
  return onIssues(args, CLOSE_USAGE, "closed", false, async (issue) => {
    const { issue: key, outcome } = await closeDispatch(ctx.world, ctx.configDir, issue, confirm);
    const result = outcome === "closed" ? "closed" : "already Closed (no-op)";
    return { output: { data: { closed: outcome === "closed" ? key : `${key} ${result}` }, help: [BOARD_HELP] }, issue: key, result };
  });
}

async function show(args: Args, ctx: RunContext): Promise<Output> {
  const { key } = resolveIssue(ctx.configDir, issueArg(args, "nico-agent show <issue>"));
  const record = findDispatch(ctx.configDir, key);
  if (!record) throw new CliError(`${key} is not In flight`, ["Run `nico-agent` to see the Board and what is In flight"]);
  const { tab, pane, ...launch } = record.implementer;
  const [row] = await loadInFlight(ctx.world, [record], freshPrs(ctx.world));
  const { stage, pr, prError } = row!;
  // Ids are filled in as steps complete; print them in a fixed order all the same.
  const data = {
    issue: record.issue,
    title: record.title,
    url: record.url,
    stage,
    pr: pr?.url,
    prError,
    failure: record.failure,
    warnings: record.warnings,
    repo: record.repo,
    branch: record.branch,
    base: record.base,
    stackedOn: record.stackedOn,
    worktree: record.worktree,
    workspace: record.workspace,
    implementer: definedOnly({ tab, pane, ...launch }),
    completed: record.completed,
    reviewer: record.reviewer,
    botSuffix: record.botSuffix,
    claimed: record.claimed,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  return { data: definedOnly(data), help: [BOARD_HELP] };
}

function definedOnly(object: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));
}

/** Whether `text` reads as a Repo's `owner/name`. */
function isSlug(text: string) {
  return /^[\w.-]+\/[\w.-]+$/.test(text);
}

function slugArg(args: Args, usage: string) {
  const slug = args.positionals[0];
  if (!slug) throw new CliError("<owner/name> is required", [`Usage: \`${usage}\``], 2);
  if (!isSlug(slug)) {
    throw new CliError(`\`${slug}\` is not an owner/name slug`, [`Usage: \`${usage}\``], 2);
  }
  return slug;
}

async function repoAdd(args: Args, ctx: RunContext): Promise<Output> {
  const usage = "nico-agent repo add <owner/name> --path <clone>";
  const slug = slugArg(args, usage);
  const path = resolve(required(args, "--path", usage));
  const team = args.flags["--linear-team"];
  const project = args.flags["--linear-project"];
  const label = args.flags["--linear-label"];
  if ((project || label) && !team) throw new CliError("--linear-project and --linear-label require --linear-team", [`Usage: \`${usage}\``], 2);
  const linear = typeof team === "string" ? { team, ...(typeof project === "string" && { project }), ...(typeof label === "string" && { label }) } : undefined;
  const base = typeof args.flags["--base"] === "string" ? args.flags["--base"] : undefined;
  const remotes = await ctx.world.gitRemotes(path);
  if (!remotes) {
    throw new CliError(`${path} is not a git clone`, [
      `Run \`git clone https://github.com/${slug} ${path}\` first, or pass the path of an existing clone`,
    ]);
  }
  const remoteSlug = remotes.map(slugOfRemote).find((s) => s !== null && sameSlug(s, slug));
  if (!remoteSlug) {
    throw new CliError(
      `${path} is not a clone of ${slug}`,
      [`Run \`nico-agent repo add <owner/name> --path ${path}\` with the slug its remote points at`],
      1,
      { remotes },
    );
  }
  const help = [BOARD_HELP, "Run `nico-agent repo list` to see all Repos"];
  const config = loadConfig(ctx.configDir);
  const existing = findRepo(config, slug);
  if (existing?.path === path && (!linear || JSON.stringify(existing.linear) === JSON.stringify(linear)) && (!base || existing.base === base)) {
    return { data: { repo: `${existing.slug} already added (no-op)`, path }, help };
  }
  const canonical = existing?.slug ?? slug;
  const repos = existing
    ? config.repos.map((r) => (r === existing ? { ...r, path, ...(linear && { linear }), ...(base && { base }) } : r))
    : [...config.repos, { slug: canonical, path, ...(linear && { linear }), ...(base && { base }) }];
  saveConfig(ctx.configDir, { ...config, repos });
  const outcome = existing ? (existing.path === path ? "selector updated" : "path updated") : "added";
  return { data: { repo: `${canonical} ${outcome}`, path }, help };
}

async function repoRm(args: Args, ctx: RunContext): Promise<Output> {
  const slug = slugArg(args, "nico-agent repo rm <owner/name>");
  const config = loadConfig(ctx.configDir);
  const existing = findRepo(config, slug);
  const help = ["Run `nico-agent repo list` to see all Repos"];
  if (!existing) return { data: { repo: `${slug} not configured (no-op)` }, help };
  saveConfig(ctx.configDir, { ...config, repos: config.repos.filter((r) => r !== existing) });
  return { data: { repo: `${existing.slug} removed` }, help };
}

async function repoList(ctx: RunContext): Promise<Output> {
  const { repos } = loadConfig(ctx.configDir);
  if (repos.length === 0) return { data: { repos: "0 configured" }, help: [ADD_REPO_HELP] };
  return {
    data: { count: repos.length, repos },
    help: [ADD_REPO_HELP, "Run `nico-agent repo rm <owner/name>` to remove one"],
  };
}

async function ordersList(ctx: RunContext, json: boolean): Promise<Output> {
  const orders = standingOrders(loadConfig(ctx.configDir));
  const help = [`Run \`${ORDERS_SET_USAGE}\` to change one`];
  if (json) return { data: { orders }, help };
  const rows = (Object.keys(ORDERS) as Order[]).map((order) => ({ order, state: orders[order] ? "on" : "off", lets: ORDERS[order].lets }));
  return { data: { orders: rows }, help };
}

async function voiceCheckCommand(ctx: RunContext): Promise<Output> {
  const { voice } = loadConfig(ctx.configDir);
  if (!voice || !VOICE_SERVICES.some((service) => voice[service])) throw new CliError("no voice services in config", [VOICE_DOCS_HELP]);
  const { services, help } = await probeVoice(ctx.world, voice);
  return { data: { services }, help, exitCode: help.length ? 1 : 0 };
}

async function voiceCommand(ctx: RunContext): Promise<Output> {
  return { data: { voice: voiceOn(ctx.configDir) ? "on" : "off" }, help: [VOICE_ON_HELP] };
}

/** Ask `serve` to start its open page's talk button; refused when serve is not running or no page is open. */
async function voiceTalk(args: Args, ctx: RunContext): Promise<Output> {
  const port = portFlag(args, VOICE_TALK_USAGE);
  let response: Response;
  try {
    response = await ctx.world.http(new Request(`http://${HOSTNAME}:${port}${TALK_PATH}`, { method: "POST" }));
  } catch {
    throw new CliError(`could not reach nico-agent serve on port ${port}`, [`Start it with \`nico-agent serve${port === DEFAULT_PORT ? "" : ` --port ${port}`}\` and open the app`]);
  }
  const answer = await response.json().catch(() => null) as { listen?: string; error?: string; help?: string[] } | null;
  if (!response.ok || !answer?.listen) {
    throw new CliError(answer?.error ?? `nico-agent serve answered ${response.status}`, answer?.help ?? []);
  }
  return { data: { listen: answer.listen }, help: answer.help ?? [] };
}

async function voiceSet(ctx: RunContext, on: boolean): Promise<Output> {
  const state = on ? "on" : "off";
  const changed = await setVoiceOn(ctx.configDir, on);
  return { data: { voice: changed ? state : `already ${state} (no-op)` }, help: [VOICE_ON_HELP] };
}

async function ordersSet(args: Args, ctx: RunContext): Promise<Output> {
  const [order, state] = args.positionals;
  const usage = `Usage: \`${ORDERS_SET_USAGE}\``;
  if (!order) throw new CliError("<order> is required", [usage], 2);
  if (!isOrder(order)) throw new CliError(`\`${order}\` is not a Standing order`, [ORDERS_HELP, usage], 2);
  if (!state) throw new CliError("<on|off> is required", [usage], 2);
  if (state !== "on" && state !== "off") throw new CliError(`\`${state}\` is not on or off`, [usage], 2);
  const help = ["Run `nico-agent orders` to see every Standing order"];
  const config = loadConfig(ctx.configDir);
  const on = state === "on";
  if (standingOrders(config)[order] === on) return { data: { order: `${order} already ${state} (no-op)` }, help };
  saveConfig(ctx.configDir, { ...config, orders: { ...config.orders, [order]: on } });
  return { data: { order: `${order} ${state}` }, help };
}

/** `nico-agent <record>` shows the Intent or the Notes; `<record> set` replaces it whole. */
function recordCommands(record: RecordName, example: string): Command[] {
  const { name, holds } = RECORDS[record];
  const setUsage = `nico-agent ${record} set [--file <path> | --text <markdown>] [--version <version>]`;
  const showHelp = `Run \`nico-agent ${record} --json\` for its version, which \`${record} set --version\` carries`;
  return [
    {
      name: record,
      usage: `nico-agent ${record}`,
      summary: `Show the ${name}: ${holds}, which the user and the Lead both edit`,
      flags: {},
      positionals: [],
      examples: [`nico-agent ${record}`, `nico-agent ${record} --json`],
      run: async (args, ctx) => {
        const { text, version, path } = readRecord(ctx.configDir, record);
        const help = [`Run \`nico-agent ${record} set --file <path>\` to replace it, or edit ${path}`];
        if (args.flags["--json"] === true) return { data: { [record]: text, version, path }, help };
        if (!text.trim()) return { data: { [record]: noneYet(path) }, help };
        return { data: { [record]: text, version }, help };
      },
    },
    {
      name: `${record} set`,
      usage: setUsage,
      summary: `Replace the ${name} whole with a Markdown file, --text or standard input (the Lead's \`${record}\` tool)`,
      flags: {
        "--file": { value: true, description: "Markdown file to replace it with (default: standard input)" },
        "--text": { value: true, description: "Markdown to replace it with, instead of a file" },
        "--version": { value: true, description: `the version you read (\`nico-agent ${record} --json\`): refused if the ${name} changed since` },
      },
      positionals: [],
      examples: [
        `nico-agent ${record} set --file ~/${record}.md`,
        `nico-agent ${record} --json | jq -r .${record} > ${record}.md; $EDITOR ${record}.md; nico-agent ${record} set --file ${record}.md`,
        `nico-agent ${record} set --text ${JSON.stringify(example)} --version 3f2a9c01d4e7`,
      ],
      help: [showHelp],
      run: async (args, ctx) => {
        const { "--file": file, "--text": inline, "--version": version } = args.flags;
        if (typeof file === "string" && typeof inline === "string") throw new CliError("--file and --text replace it two ways; pass one", [`Usage: \`${setUsage}\``], 2);
        const text = typeof inline === "string" ? inline : typeof file === "string" ? readMarkdown(file) : await readStdin(ctx, setUsage, "nothing to replace it with: pass --file, or pipe the Markdown in");
        try {
          const replaced = await replaceRecord(ctx.configDir, record, text, typeof version === "string" ? version : undefined);
          return { data: { replaced: replaced.path, version: replaced.version }, help: [`Run \`nico-agent ${record}\` to see it`] };
        } catch (e) {
          if (!(e instanceof StaleRecord)) throw e;
          const { text: current, version: now } = e.current;
          throw new CliError(`the ${name} changed since version ${version} was read`, [
            `Merge your change into the current ${name} returned here, then replace it again with --version ${now}`,
          ], 1, { version: now, [record]: current });
        }
      },
    },
  ];
}

function readMarkdown(file: string) {
  try {
    return readFileSync(resolve(file), "utf8");
  } catch (e) {
    throw new CliError(`cannot read ${file}: ${(e as NodeJS.ErrnoException).code ?? String(e)}`, ["Pass --file a Markdown file you can read"]);
  }
}

async function readStdin(ctx: RunContext, usage: string, missing: string) {
  if (!ctx.stdin) throw new CliError(missing, [`Usage: \`${usage}\``], 2);
  return await ctx.stdin();
}

const HARNESS_LIST_HELP = "Run `nico-agent harness list` to see the models and Effort levels";

async function harnessList(ctx: RunContext, json: boolean): Promise<Output> {
  const catalogs = await harnessCatalogs(ctx.world, ctx.configDir);
  // The app's launch forms start on the last launch, and on the Effort last used with each model.
  const { last, efforts } = rememberedLaunches(ctx.configDir);
  return {
    data: {
      count: catalogs.length,
      harnesses: catalogs.map(({ harness, models, source, error }) => ({
        name: harness.name,
        launch: `${harness.launchMode} ${harness.launchMode === "pane-command" ? harness.command : harness.kind}`,
        sigil: harness.sigil,
        args: [
          ...(harness.launchMode === "pane-command" ? PANE_ARGS : []),
          ...harness.modelArgs, ...harness.effortArgs, ...(harness.trustArgs ?? []), ...harness.extraArgs,
        ].join(" "),
        models,
        source,
        ...(error && { error }),
      })),
      ...(json && { remembered: { ...(last && { last }), efforts } }),
    },
    help: [
      "Run `nico-agent harness refresh` to discover models again",
      `Run \`${DISPATCH_USAGE}\` to dispatch an issue`,
    ],
  };
}

async function harnessRefresh(ctx: RunContext): Promise<Output> {
  const refreshed = await refreshHarnesses(ctx.world, ctx.configDir);
  const failed = refreshed.some((c) => c.error);
  const row = ({ harness, models, source, error }: Catalog) => ({
    harness: harness.name,
    models: models.length,
    source,
    ...(failed && { error: error ?? "" }),
  });
  // A list even when empty, so --json readers always get one shape.
  return { data: { refreshed: refreshed.map(row) }, help: [HARNESS_LIST_HELP], exitCode: failed ? 1 : 0 };
}

const HOSTNAME = "127.0.0.1";
const DEFAULT_PORT = 42069;

/** The `--port` flag's port, `DEFAULT_PORT` without one. */
function portFlag(args: Args, usage: string) {
  const flag = args.flags["--port"];
  const port = typeof flag === "string" ? Number(flag) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CliError(`the port must be a number from 1 to 65535 (got \`${flag}\`)`, [`Usage: \`${usage}\``], 2);
  }
  return port;
}

function mcpUrl(port: number) {
  return `http://${HOSTNAME}:${port}/mcp`;
}

/** Commands that change what the Board shows, so `serve` reads GitHub afresh after them, failed or not. */
const BOARD_CHANGES = ["dispatch", "review", "close", "garden", "queue", "unqueue", "move", "advance", "proposals approve"];

function changesBoard(argv: string[]) {
  return BOARD_CHANGES.some((command) => command.split(" ").every((word, i) => argv[i] === word));
}

async function serve(args: Args, ctx: RunContext): Promise<Output> {
  const port = portFlag(args, "nico-agent serve [--port <port>]");
  const events = new Events();
  const look = lookAtLead(ctx, events);
  // Its runs come from the app and the Lead's tools, never from serve's own standard input.
  // They read GitHub through a cache, so a Board costs GitHub a read a minute.
  const github = cachingGitHubReads(ctx.world);
  const { stdin: _, ...served } = { ...ctx, world: github.world };
  const shared = { ...served, prs: ctx.prs ?? freshPrs(served.world) };
  try {
    const runCli = async (argv: string[]) => {
      try {
        return await run(argv, shared);
      } finally {
        // What nico-agent just did shows on the next Board, not a minute later.
        if (changesBoard(argv)) github.forget();
      }
    };
    await ctx.world.serve({ hostname: HOSTNAME, port }, webHandler({ ...ctx, events, look, runCli }), { "/": app }, webSockets({ ...ctx, runCli, events }));
  } catch (e) {
    if (!(e instanceof WorldError)) throw e;
    throw new CliError(e.message, ["Run `nico-agent serve --port <port>` with a free port"]);
  }
  // A Nudge recorded while the Lead worked waits for serve to see it idle.
  ctx.world.every(NUDGE_INTERVAL_MS, async () => {
    // Agent states change outside nico-agent, so the app refetches the Board on every tick,
    // and hears of the Lead's, and of what the CLI wrote to the conversation and the Proposals.
    events.emit("board-changed");
    await look();
    for (const warning of await sendPendingNudge(ctx.world, ctx.configDir)) console.error(warning);
  });
  // A merged PR with others stacked on it, or a conflict, waits for its Repo's next Gardener;
  // each tick starts one wherever PRs wait and none runs.
  const startGardeners = async () => {
    try {
      const { started, warnings } = await withCaller("gardener", () => startQueuedGardeners(served.world, ctx.configDir));
      for (const warning of warnings) console.error(`garden: ${warning}`);
      for (const g of started) console.error(`garden: started the Gardener of ${g.repo} for ${g.prs.map((pr) => pr.url).join(", ")}`);
      if (started.length) events.emit("board-changed");
    } catch (e) {
      console.error(`garden failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  // What changes on a PR reaches the Lead as events in its Inbox.
  ctx.world.every(PR_WATCH_INTERVAL_MS, async () => {
    try {
      const { events: written, warnings, gardening } = await withCaller("pr watch", () => watchPrs(served.world, ctx.configDir, shared.prs));
      for (const warning of warnings) console.error(`PR events: ${warning}`);
      await queueGardening(ctx.configDir, gardening);
      if (!written.length) return;
      // Something happened on a PR, so the Board may have moved with it.
      github.forget();
      for (const warning of await nudgeLead(ctx.world, ctx.configDir)) console.error(warning);
    } catch (e) {
      console.error(`PR events failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await startGardeners();
    }
  });
  // The Scheduler: serve tends the Board while it is up, reading GitHub through the same cache.
  ctx.world.every(ADVANCE_INTERVAL_MS, async () => {
    try {
      const { data } = advanceOutput(await withCaller("scheduler", () => advance(served.world, ctx.configDir)));
      console.error(`advance: ${render({ data }, false).trimEnd()}`);
    } catch (e) {
      // A failed tick is only logged: the next one tries again.
      console.error(`advance failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      github.forget();
      events.emit("board-changed");
    }
  });
  const mcp = mcpUrl(port);
  return {
    data: { url: `http://${HOSTNAME}:${port}/`, mcp },
    help: [
      "Open the url in a browser to see the Board; stop the server with Ctrl-C",
      `Register the MCP server with Claude Code: \`claude mcp add --transport http nico-agent ${mcp}\``,
    ],
  };
}

async function gardenCommand(args: Args, ctx: RunContext): Promise<Output> {
  const slug = args.positionals[0];
  if (!slug) throw new CliError("<repo> is required", [`Usage: \`${GARDEN_USAGE}\``], 2);
  const repo = gardenRepo(ctx.configDir, slug);
  const refs = args.flags["--pr"];
  const { gardener, outcome, resumedFrom } = await garden(ctx.world, ctx.configDir, { repo: repo.slug, prs: Array.isArray(refs) ? refs : [] });
  const { agent, harness, model, effort } = gardener.agent;
  const result = { new: "started", existing: "already running (no-op)", resumed: `resumed from ${resumedFrom}` }[outcome];
  return {
    data: definedOnly({
      gardener: result,
      repo: gardener.repo,
      workspace: gardener.workspace,
      agent,
      harness, model, effort,
      prs: describePrs(gardener.repo, gardener.prs),
      warnings: gardener.warnings,
    }),
    help: [`Run \`herdr agent read ${agent}\` to see its screen`, BOARD_HELP],
  };
}

async function leadStartCommand(args: Args, ctx: RunContext): Promise<Output> {
  const { "--harness": harnessFlag, "--model": modelFlag, "--effort": effortFlag } = args.flags;
  const request = {
    mcpUrl: mcpUrl(portFlag(args, LEAD_START_USAGE)),
    ...(typeof harnessFlag === "string" && { harness: harnessFlag }),
    ...(typeof modelFlag === "string" && { model: modelFlag }),
    ...(typeof effortFlag === "string" && { effort: effortFlag }),
  };
  const { lead, outcome, resumedFrom, replaced } = await startLead(ctx.world, ctx.configDir, request);
  const { harness, model, effort } = lead.agent;
  const result = {
    new: "started",
    existing: "already running (no-op)",
    resumed: `resumed from ${resumedFrom}`,
    restarted: replaced ? `restarted, replacing ${replaced.harness} ${replaced.model} ${replaced.effort}` : "restarted",
  }[outcome];
  const help = [LEAD_STATUS_HELP, LEAD_SCREEN_HELP];
  if (!findRepo(loadConfig(ctx.configDir), NICO_AGENT_SLUG)) {
    help.push("Run `nico-agent repo add nicolasLuduena/nico-agent --path <clone>` to give the Lead the shaping skills");
  }
  help.push(`Make sure \`nico-agent serve\` runs, so the Lead reaches ${lead.mcpUrl}`);
  return {
    data: {
      lead: result,
      workspace: lead.workspace,
      agent: LEAD_AGENT,
      harness, model, effort,
      home: lead.home,
      mcp: lead.mcpUrl,
      ...(lead.warnings && { warnings: lead.warnings }),
    },
    help,
  };
}

async function leadStatusCommand(ctx: RunContext): Promise<Output> {
  const status = await leadStatus(ctx.world, ctx.configDir);
  if (!status) return { data: { lead: "not running" }, help: [`Run \`${LEAD_START_USAGE}\` to start it`] };
  const { record, lead, state } = status;
  const { harness, model, effort } = record.agent;
  const help = lead === "running"
    ? [LEAD_SCREEN_HELP, "Run `nico-agent lead stop` to stop it"]
    : ["Run `nico-agent lead start` to start it again", "Run `nico-agent lead stop` to forget it"];
  return {
    data: definedOnly({
      lead,
      workspace: record.workspace,
      agent: LEAD_AGENT,
      harness, model, effort,
      state,
      home: record.home,
      mcp: record.mcpUrl,
      failure: record.failure,
      warnings: record.warnings,
      startedAt: record.createdAt,
    }),
    help,
  };
}

async function leadStopCommand(ctx: RunContext): Promise<Output> {
  const { outcome, workspace } = await stopLead(ctx.world, ctx.configDir);
  const help = [`Run \`${LEAD_START_USAGE}\` to start it again; the conversation is kept`];
  if (outcome === "none") return { data: { lead: "not running (no-op)" }, help };
  return { data: definedOnly({ lead: "stopped", workspace }), help };
}

async function board(ctx: RunContext, json: boolean): Promise<Output> {
  const { repos } = loadConfig(ctx.configDir);
  // The app draws a section per Repo, so `--json` names them.
  const header = { bin: ctx.bin, description: DESCRIPTION, repos: `${repos.length} configured`, ...(json && { configured: repos.map((r) => r.slug) }) };
  if (repos.length === 0) {
    return { data: { ...header, ready: "0 issues (no Repos configured)" }, help: [ADD_REPO_HELP] };
  }
  const loaded = await loadBoard(ctx.world, repos, loadDispatches(ctx.configDir), ctx.prs ?? cachedPrs(ctx.world), rememberedLaunches(ctx.configDir).bases);
  // Each read keeps when an issue was first seen, for `stats`' issues defined.
  await recordSighting(ctx.configDir, loaded.sighting, ctx.world.now());
  const { ready, stackable, withPr, specs, inFlight } = loaded;
  // A rate-limited GitHub is one warning with its reset time, not an error on every Repo and Dispatch.
  const limited = (message?: string) => message?.startsWith(RATE_LIMITED) ?? false;
  const warning = [...loaded.errors.map((e) => e.error), ...inFlight.map((r) => r.prError)].find(limited);
  const errors = loaded.errors.filter((e) => !limited(e.error));
  const help = ["Run `nico-agent repo list` to see the Repos", ADD_REPO_HELP];
  if (inFlight.length) help.unshift("Run `nico-agent show <issue>` to see a Dispatch");
  const blocked = inFlight.flatMap(({ dispatch: d, implementerState, reviewerState }) => [
    ...(implementerState === "blocked" ? [d.implementer.agent] : []),
    ...(reviewerState === "blocked" ? [d.reviewer!.agent] : []),
  ].map((agent) => `Run \`herdr agent read ${agent}\` to see what the blocked agent of ${d.issue} is waiting on`));
  if (inFlight.some((row) => row.stage === "PR ready")) {
    help.unshift(
      `Run \`nico-agent review <issue> --harness ${harnesses(ctx.configDir)[0]!.name} --model <model> --effort <effort>\` to review an issue whose PR is ready`,
    );
  }
  if (ready.length) {
    help.unshift(
      `Run \`nico-agent dispatch <issue> --harness ${harnesses(ctx.configDir)[0]!.name} --model <model> --effort <effort>\` to dispatch a Ready issue`,
    );
  }
  // Agents waiting on the user come first.
  if (inFlight.some((row) => row.implementerState === "blocked")) blocked.push("Run `nico-agent answer <issue> <text>` to answer an Implementer waiting on you");
  help.unshift(...blocked);
  // The question `nico-agent answer` replies to, for a user away from herdr; the TOON Board points at `herdr agent read` instead.
  const gardenerStates = await gardenerRows(ctx.world, ctx.configDir);
  const asking = json ? await loadAsking(ctx.world, inFlight, specs, gardenerStates) : [];
  // Each Repo's Gardener, with the PRs it was sent to; none listed means every one that needs it.
  const gardeners = gardenerStates.map(({ gardener: g, state }) => ({
    repo: g.repo,
    agent: g.agent.agent,
    state,
    prs: g.prs.map((pr) => pr.url),
    workspace: g.workspace ?? "",
    harness: g.agent.harness,
    model: g.agent.model,
    effort: g.agent.effort,
    ...(json && definedOnly({ failure: g.failure?.error, warnings: g.warnings?.length ? g.warnings : undefined })),
  }));
  const askingGardeners = gardeners.filter((g) => g.state === "blocked");
  if (askingGardeners.length) help.unshift("Run `nico-agent answer <repo> <text>` to answer a Gardener waiting on you");
  help.unshift(...askingGardeners.map((g) => `Run \`herdr agent read ${g.agent}\` to see what the Gardener of ${g.repo} is asking`));
  const inFlightData = {
    ...(gardeners.length > 0 && { gardeners }),
    inFlight: plural(inFlight.length, "Dispatch", "Dispatches"),
    ...(inFlight.length > 0 && {
      dispatches: inFlight.map(({ dispatch: d, stage, pr, prError, implementerState, reviewerState }) => ({
        issue: d.issue,
        title: d.title,
        ...(json && { repo: d.repo, url: d.url, ...(d.research && { research: true }) }),
        stage,
        pr: pr?.url ?? "",
        ...(prError && !limited(prError) && { prError }),
        implementer: implementerState,
        reviewer: reviewerState ?? "",
        harness: d.implementer.harness,
        model: d.implementer.model,
        effort: d.implementer.effort,
        base: baseBranch(d) ?? "",
        workspace: d.workspace ?? "",
        ...(json && definedOnly({ failure: (d.failure ?? d.reviewer?.failure)?.error, warnings: d.warnings?.length ? d.warnings : undefined, retry: retryArgs(d) })),
      })),
    }),
  };
  // A failed branch listing still loaded the Repo's issues.
  const failedRepos = repos.filter((r) => loaded.errors.filter((e) => e.repo === r.slug && e.source !== "git").length === (r.linear ? 2 : 1)).length;
  if (failedRepos === repos.length) {
    const data = { ...header, ready: "0 issues (no Repo could be loaded)", ...inFlightData, ...(asking.length && { asking }), ...(warning && { warning }), ...(errors.length && { errors }) };
    return { data, help, exitCode: 1 };
  }
  const count = ready.length
    ? plural(ready.length, "issue")
    : `0 issues across ${plural(repos.length - failedRepos, "Repo")}`;
  const data: Record<string, unknown> = { ...header, ready: count };
  // In TOON a GitHub key names its Repo already; the app is told each issue's Repo and URL, for its section and hover card, and whether it is a Research issue.
  const where = (i: BoardIssue) => (json ? { repo: i.repo, url: i.url, ...(i.research && { research: true }) } : i.identifier ? { repo: i.repo } : {});
  if (ready.length) {
    data.issues = ready.map((i) => ({ issue: i.identifier ?? `${i.repo}#${i.number}`, title: i.title, ...where(i), ...(i.base && { base: i.base }) }));
  }
  if (stackable.length) {
    data.stackable = stackable.map((i) => ({ issue: i.identifier ?? `${i.repo}#${i.number}`, title: i.title, ...where(i),
      blockers: i.blockers.map((b) => ({ issue: b.blocker, pr: b.pr.url, base: b.pr.headBranch })) }));
    help.unshift("Run `nico-agent dispatch <issue> --stack-on <blocker> --harness <harness> --model <model> --effort <effort>` to dispatch a Stackable issue");
  }
  if (withPr.length) {
    // Started outside a Dispatch nico-agent still tracks: review or merge the PR, then close the issue.
    data.prOpen = withPr.map((i) => ({ issue: i.identifier ?? `${i.repo}#${i.number}`, title: i.title, ...where(i), pr: i.pr.url, state: i.pr.state }));
  }
  const allSpecs = specs.flatMap((r) => r.specs);
  // In TOON, Specs of one would only repeat the Ready and In-flight lists, unless Held.
  const specRows = json ? allSpecs : allSpecs.filter((s) => s.held || s.issues.length !== 1 || s.issues[0] !== s.spec);
  if (specRows.length) {
    data.specs = specRows.map(({ spec, title, url, repo, issues, running, held, next, waiting, reason }) => ({
      spec, title, ...(json && { url }), repo, issues, running,
      ...(held && { held }),
      // In TOON a candidate's first issue is listed under `rooms`; the app shows why it is first.
      ...((running || json) && next.length && { next: next.map((n) => ({ issue: n.issue, ...(n.stackOn && { stackOn: n.stackOn.url }), base: n.base, reason: n.reason })) }),
      ...(waiting.length && { waiting }),
      ...(reason && { reason }),
    }));
  }
  if (allSpecs.length) {
    // Each Repo's room, its candidate Specs, and its Queue head first, as `queue`, `unqueue` and `move` and the web Board edit it.
    const queues = await pruneBoardQueues(ctx.configDir, loaded);
    data.rooms = specs.map(({ repo, specs: decided, room, candidates }) => ({
      repo, running: decided.filter((s) => s.running).map((s) => s.spec), room,
      candidates: decided.filter((s) => candidates.includes(s.spec))
        .map(({ spec, title, url, next }) => ({ spec, title, url, issue: next[0]!.issue })),
      queue: queueOf(queues, repo).map((queued) => decided.find((s) => sameSpec(s.spec, queued))?.spec ?? queued),
    }));
  }
  // The app's dispatch forms offer origin's branches as the Base; each Ready issue names the one it starts on.
  if (json && Object.keys(loaded.bases).length) {
    data.bases = repos.flatMap((r) => (loaded.bases[r.slug] ? [{ repo: r.slug, branches: loaded.bases[r.slug]!.branches }] : []));
  }
  Object.assign(data, inFlightData);
  if (asking.length) data.asking = asking;
  if (warning) data.warning = warning;
  if (errors.length) data.errors = errors;
  return { data, help };
}

/** The arguments that retry a failed launch: its own command again, which resumes it from its failed step (ADR-0006). */
function retryArgs(d: Dispatch): string[] | undefined {
  const failed = d.failure ? { command: "dispatch", launch: d.implementer } : d.reviewer?.failure ? { command: "review", launch: d.reviewer } : null;
  if (!failed) return undefined;
  const { harness, model, effort } = failed.launch;
  const stackOn = failed.command === "dispatch" ? d.stackedOn?.pr.url : undefined;
  return [failed.command, d.issue, "--harness", harness, "--model", model, "--effort", effort, ...(stackOn ? ["--stack-on", stackOn] : [])];
}

function lowerFirst(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
