import { resolve } from "node:path";
import { loadBoard } from "./board";
import { ConfigError, findRepo, loadConfig, saveConfig } from "./config";
import { DispatchError, StepFailed, closeDispatch, dispatch, resolveIssue, review } from "./dispatch";
import { type Catalog, harnessCatalogs, harnesses, refreshHarnesses } from "./harness";
import { type Output, render } from "./output";
import { VERSION } from "./version";
import { sameSlug, slugOfRemote } from "./slug";
import { cachedPrs, currentStage, freshPrs, loadInFlight, stageOf } from "./stage";
import { findDispatch, loadDispatches } from "./state";
import { webHandler } from "./web";
import { type World, WorldError } from "./world";

export interface RunContext {
  world: World;
  configDir: string;
  /** Path of the running executable, home collapsed to `~`. */
  bin: string;
}

export interface RunResult {
  stdout: string;
  exitCode: number;
}

const DESCRIPTION = "Dispatch coding agents onto ready-for-agent issues";
const ADD_REPO_HELP = "Run `nico-agent repo add <owner/name> --path <clone>` to add a Repo";
const BOARD_HELP = "Run `nico-agent` to see the Board";
const DISPATCH_USAGE = "nico-agent dispatch <issue> --harness <harness> --model <model> --effort <effort>";
const REVIEW_USAGE = "nico-agent review <issue> --harness <harness> --model <model> --effort <effort>";
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
  flags: Record<string, string | true>;
}

interface Command {
  name: string;
  usage: string;
  summary: string;
  /** Command-specific flags; `value` marks a flag that takes a value. */
  flags: Record<string, { value: boolean; description: string }>;
  positionals: string[];
  examples: string[];
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
    run: (_args, ctx) => board(ctx),
  },
  {
    name: "repo add",
    usage: "nico-agent repo add <owner/name> --path <clone>",
    summary: "Add a Repo after checking the path is a clone of it",
    flags: { "--path": { value: true, description: "path of a local clone of the repo (required)" } },
    positionals: ["owner/name"],
    examples: ["nico-agent repo add acme/api --path ~/src/api"],
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
    summary: "Start an Implementer on an issue in a new herdr worktree workspace (resumes a failed one)",
    flags: LAUNCH_FLAGS,
    positionals: ["issue"],
    examples: [
      "nico-agent dispatch acme/api#7 --harness claude --model opus --effort high",
      "nico-agent dispatch https://github.com/acme/api/issues/7 --harness claude --model sonnet --effort max",
    ],
    run: dispatchCommand,
  },
  {
    name: "review",
    usage: REVIEW_USAGE,
    summary: "Start a Reviewer on an In-flight issue's linked PR, in its workspace (resumes a failed one)",
    flags: LAUNCH_FLAGS,
    positionals: ["issue"],
    examples: ["nico-agent review acme/api#7 --harness codex --model gpt-5.5 --effort high"],
    run: reviewCommand,
  },
  {
    name: "close",
    usage: "nico-agent close <issue> [--confirm]",
    summary: "Remove a Dispatch's workspace and forget it, keeping its branch",
    flags: { "--confirm": { value: false, description: "close even with an open PR or no linked PR" } },
    positionals: ["issue"],
    examples: ["nico-agent close acme/api#7", "nico-agent close acme/api#7 --confirm"],
    run: async (args, ctx) => {
      const result = await closeDispatch(ctx.world, ctx.configDir, issueArg(args, "nico-agent close <issue> [--confirm]"), args.flags["--confirm"] === true);
      return { data: { closed: result.outcome === "closed" ? result.issue : `${result.issue} already Closed (no-op)` }, help: [BOARD_HELP] };
    },
  },
  {
    name: "harness list",
    usage: "nico-agent harness list",
    summary: "List the Harnesses with their models and Effort levels (discovers uncached ones)",
    flags: {},
    positionals: [],
    examples: ["nico-agent harness list", "nico-agent harness list --json"],
    run: (_args, ctx) => harnessList(ctx),
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
    name: "serve",
    usage: "nico-agent serve [--port <port>]",
    summary: "Start the web app on 127.0.0.1 (port 42069 by default)",
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
  const json = argv.includes("--json");
  try {
    const { command, rest } = findCommand(argv);
    const args = parseArgs(command, rest);
    const topLevel = argv[0]?.startsWith("-") ?? true;
    const output = !args.flags["--help"]
      ? await command.run(args, ctx)
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
    args.flags[name] = value;
  }
  if (args.flags["--help"]) return args;
  if (args.positionals.length > command.positionals.length) {
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
  };
}

function required(args: Args, flag: string, usage: string) {
  const value = args.flags[flag];
  if (typeof value !== "string") throw new CliError(`missing required flag ${flag}`, [`Usage: \`${usage}\``], 2);
  return value;
}

function launchRequest(args: Args, usage: string) {
  return {
    issue: issueArg(args, usage),
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

async function dispatchCommand(args: Args, ctx: RunContext): Promise<Output> {
  const { dispatch: record, outcome, resumedFrom } = await dispatch(ctx.world, ctx.configDir, launchRequest(args, DISPATCH_USAGE));
  // A Dispatch just run has no PR yet; an existing one may.
  const stage = outcome === "existing" ? await currentStage(ctx.world, record) : stageOf(record, null);
  const dispatched = {
    new: record.issue,
    existing: `${record.issue} already In flight (no-op)`,
    resumed: `${record.issue} (resumed from ${resumedFrom})`,
  }[outcome];
  const help = [`Run \`nico-agent show ${record.issue}\` to see the Dispatch`, BOARD_HELP];
  if (record.claimed === false) help.unshift(`Assign ${record.url} to yourself on GitHub to Claim it by hand`);
  return {
    data: {
      dispatched,
      stage,
      workspace: record.workspace,
      agent: record.implementer.agent,
      ...(record.warnings && { warnings: record.warnings }),
    },
    help,
  };
}

async function reviewCommand(args: Args, ctx: RunContext): Promise<Output> {
  const { dispatch: record, outcome, resumedFrom } = await review(ctx.world, ctx.configDir, launchRequest(args, REVIEW_USAGE));
  const reviewer = record.reviewer!;
  const reviewing = {
    new: record.issue,
    existing: `${record.issue} already launched (no-op)`,
    resumed: `${record.issue} (resumed from ${resumedFrom})`,
  }[outcome];
  return {
    data: {
      reviewing,
      // A Reviewer just run was prompted, so the PR can't change the Stage.
      stage: outcome === "existing" ? await currentStage(ctx.world, record) : stageOf(record, null),
      pr: reviewer.prUrl,
      workspace: record.workspace,
      agent: reviewer.agent,
    },
    help: [`Run \`nico-agent show ${record.issue}\` to see the Dispatch`, BOARD_HELP],
  };
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

function slugArg(args: Args, usage: string) {
  const slug = args.positionals[0];
  if (!slug) throw new CliError("<owner/name> is required", [`Usage: \`${usage}\``], 2);
  if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) {
    throw new CliError(`\`${slug}\` is not an owner/name slug`, [`Usage: \`${usage}\``], 2);
  }
  return slug;
}

async function repoAdd(args: Args, ctx: RunContext): Promise<Output> {
  const usage = "nico-agent repo add <owner/name> --path <clone>";
  const slug = slugArg(args, usage);
  const path = resolve(required(args, "--path", usage));
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
  if (existing?.path === path) {
    return { data: { repo: `${existing.slug} already added (no-op)`, path }, help };
  }
  const canonical = existing?.slug ?? slug;
  const repos = existing
    ? config.repos.map((r) => (r === existing ? { ...r, path } : r))
    : [...config.repos, { slug: canonical, path }];
  saveConfig(ctx.configDir, { ...config, repos });
  return { data: { repo: `${canonical} ${existing ? "path updated" : "added"}`, path }, help };
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

const HARNESS_LIST_HELP = "Run `nico-agent harness list` to see the models and Effort levels";

async function harnessList(ctx: RunContext): Promise<Output> {
  const catalogs = await harnessCatalogs(ctx.world, ctx.configDir);
  return {
    data: {
      count: catalogs.length,
      harnesses: catalogs.map(({ harness, models, source, error }) => ({
        name: harness.name,
        launch: `${harness.launchMode} ${harness.kind}`,
        sigil: harness.sigil,
        args: [...harness.modelArgs, ...harness.effortArgs, ...(harness.trustArgs ?? []), ...harness.extraArgs].join(" "),
        models,
        source,
        ...(error && { error }),
      })),
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

async function serve(args: Args, ctx: RunContext): Promise<Output> {
  const usage = "nico-agent serve [--port <port>]";
  const flag = args.flags["--port"];
  const port = typeof flag === "string" ? Number(flag) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CliError(`the port must be a number from 1 to 65535 (got \`${flag}\`)`, [`Usage: \`${usage}\``], 2);
  }
  try {
    await ctx.world.serve({ hostname: HOSTNAME, port }, webHandler(ctx));
  } catch (e) {
    if (!(e instanceof WorldError)) throw e;
    throw new CliError(e.message, ["Run `nico-agent serve --port <port>` with a free port"]);
  }
  return {
    data: { url: `http://${HOSTNAME}:${port}/` },
    help: ["Open the url in a browser to see the Board; stop the server with Ctrl-C"],
  };
}

async function board(ctx: RunContext): Promise<Output> {
  const { repos } = loadConfig(ctx.configDir);
  const header = { bin: ctx.bin, description: DESCRIPTION, repos: `${repos.length} configured` };
  if (repos.length === 0) {
    return { data: { ...header, ready: "0 issues (no Repos configured)" }, help: [ADD_REPO_HELP] };
  }
  const { ready, inFlight, errors } = await loadBoard(ctx.world, repos, loadDispatches(ctx.configDir), cachedPrs(ctx.world));
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
  help.unshift(...blocked);
  const inFlightData = {
    inFlight: plural(inFlight.length, "Dispatch", "Dispatches"),
    ...(inFlight.length > 0 && {
      dispatches: inFlight.map(({ dispatch: d, stage, pr, prError, implementerState, reviewerState }) => ({
        issue: d.issue,
        title: d.title,
        stage,
        pr: pr?.url ?? "",
        ...(prError && { prError }),
        implementer: implementerState,
        reviewer: reviewerState ?? "",
        harness: d.implementer.harness,
        model: d.implementer.model,
        effort: d.implementer.effort,
        workspace: d.workspace ?? "",
      })),
    }),
  };
  if (errors.length === repos.length) {
    return { data: { ...header, ready: "0 issues (no Repo could be loaded)", ...inFlightData, errors }, help, exitCode: 1 };
  }
  const count = ready.length
    ? plural(ready.length, "issue")
    : `0 issues across ${plural(repos.length - errors.length, "Repo")}`;
  const data: Record<string, unknown> = { ...header, ready: count };
  if (ready.length) data.issues = ready.map((i) => ({ issue: `${i.repo}#${i.number}`, title: i.title }));
  Object.assign(data, inFlightData);
  if (errors.length) data.errors = errors;
  return { data, help };
}

function plural(count: number, noun: string, nouns = `${noun}s`) {
  return `${count} ${count === 1 ? noun : nouns}`;
}

function lowerFirst(text: string) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
