import { describeStorage, getStorageRole } from "@/lib/model/storage-role";
import { getNodeMachineBuildCount } from "@/lib/model/passive-production";
import { calculateThroughput } from "@/lib/solver";
import type {
  FactoryEdge,
  FactoryPocket,
  FactoryProject,
  ResourceAmount,
  ResourceBalance,
  ThroughputResult,
} from "@/lib/model/types";
import { collectPocketMembers, listPocketPortResources } from "@/lib/model/pocket-connections";
import { closeBoundaries } from "@/lib/solver/close-boundaries";
import { makeResourceKey, resourceMatchesInput } from "@/lib/model/resources";
import { makeResourceHandleId, parseResourceHandleId } from "./resource-handles";
import type { RailPort } from "./node-verdict";

/**
 * One port row on a collapsed pocket card: a resource the dimension needs
 * from the outside (input) or offers to it (output), at the rate the members
 * would move running by themselves.
 */
export interface PocketPortSummary {
  kind: ResourceBalance["kind"];
  resourceId: string;
  displayName?: string;
  iconPath?: string;
  iconAtlas?: ResourceAmount["iconAtlas"];
  dominantColor?: string;
  ratePerSecond: number;
}

export interface PocketSummary {
  inputs: PocketPortSummary[];
  outputs: PocketPortSummary[];
  /** Machines inside, nested pockets included. */
  machineCount: number;
  /** Cards inside, nested pockets included. */
  memberCount: number;
}

/**
 * What a pocket looks like from the outside: run the solver over ONLY its
 * members (wires to the rest of the plan dropped), and the sub-plan's
 * unmet inputs become the card's input ports while its unconsumed outputs
 * become the card's output ports — the same NEED/OUTPUT split the right-hand
 * panel shows for the whole plan, scoped to one dimension.
 *
 * Computed per project commit for the pockets on screen; the sub-plans are
 * small, so a full scoped solve is cheaper than it sounds.
 */
export function computePocketSummaries(
  project: FactoryProject,
  pockets: FactoryPocket[],
): Map<string, PocketSummary> {
  const summaries = new Map<string, PocketSummary>();
  if (pockets.length === 0) {
    return summaries;
  }

  const allPockets = project.pockets ?? [];
  const icons = buildResourceIconLookup(project);
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe]));

  for (const pocket of pockets) {
    // Membership is transitive: a nested pocket's machines count toward the
    // outer card, because from out here they are all "inside".
    const pocketIds = new Set<string>([pocket.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const entry of allPockets) {
        if (
          entry.parentPocketId !== undefined &&
          pocketIds.has(entry.parentPocketId) &&
          !pocketIds.has(entry.id)
        ) {
          pocketIds.add(entry.id);
          grew = true;
        }
      }
    }

    const nodes = project.nodes.filter(
      (node) => node.pocketId !== undefined && pocketIds.has(node.pocketId),
    );
    const storages = (project.storages ?? []).filter(
      (storage) => storage.pocketId !== undefined && pocketIds.has(storage.pocketId),
    );
    const memberIds = new Set<string>([
      ...nodes.map((node) => node.id),
      ...storages.map((storage) => storage.id),
    ]);
    const edges = project.edges.filter(
      (edge) => memberIds.has(edge.source) && memberIds.has(edge.target),
    );

    // Heal the cut before solving, exactly as calculateSelectionFlow does.
    // The plan is closed at both ends, so every wire severed at the pocket
    // boundary leaves a bare slot that stops its machine dead — left alone,
    // the scoped solve answers zero for any pocket that touches the outside
    // world, and the card draws no ports at all (unless the sketch toggle
    // happened to close the boundary for it).
    const scoped = calculateThroughput(
      closeBoundaries({
        ...project,
        nodes,
        storages,
        annotations: [],
        edges,
      }),
    );

    const toPort = (balance: ResourceBalance, ratePerSecond: number): PocketPortSummary => {
      const icon = icons.get(balance.key);
      return {
        kind: balance.kind,
        resourceId: balance.resourceId,
        displayName: balance.displayName ?? icon?.displayName,
        iconPath: icon?.iconPath,
        iconAtlas: icon?.iconAtlas,
        dominantColor: icon?.dominantColor,
        ratePerSecond,
      };
    };

    const inputs = scoped.externalInputs.map((balance) =>
      toPort(balance, balance.deficitPerSecond),
    );
    const outputs = scoped.unconsumedOutputs.map((balance) =>
      toPort(balance, balance.surplusPerSecond),
    );

    // Every wire crossing the boundary gets a port even when the members-only
    // solve reports nothing for its resource (an internally covered input
    // also fed from outside, a fully consumed output also exported). Port
    // identity derives exactly as the board's edge remap does — the stored
    // handle first, the wire's resource as fallback — so a crossing wire
    // always finds its rendered port and can never turn invisible.
    const portFromEdge = (
      edge: FactoryEdge,
      side: "input" | "output",
    ): PocketPortSummary => {
      const parsed = parseResourceHandleId(
        side === "input" ? edge.targetHandle : edge.sourceHandle,
      );
      const kind = parsed?.kind ?? edge.resourceKind;
      const resourceId = parsed?.resourceId ?? edge.resourceId;
      const icon = icons.get(`${kind}:${resourceId}`);
      return {
        kind,
        resourceId,
        displayName: icon?.displayName ?? edge.label,
        iconPath: icon?.iconPath,
        iconAtlas: icon?.iconAtlas,
        dominantColor: icon?.dominantColor,
        ratePerSecond: 0,
      };
    };
    const seenInputs = new Set(inputs.map((port) => `${port.kind}:${port.resourceId}`));
    const seenOutputs = new Set(outputs.map((port) => `${port.kind}:${port.resourceId}`));
    // A wire's resource and a member's recipe can name one physical thing
    // differently - concrete carbon dust on the line, oredict carbon dust in
    // the machine. Both used to earn a row, so the card grew two Carbon Dust
    // inputs: the real one, and a phantom carrying no rate at all. One
    // resource is one port, so a crossing wire whose resource is merely a
    // compatible form of a row already on the card rides THAT row.
    const coveredBy = (side: "input" | "output", port: PocketPortSummary) =>
      listPocketPortResources(project, pocket.id, side).some(
        (entry) =>
          !(entry.kind === port.kind && entry.id === port.resourceId) &&
          resourceMatchesInput({ kind: port.kind, id: port.resourceId }, entry) &&
          (side === "input" ? seenInputs : seenOutputs).has(`${entry.kind}:${entry.id}`),
      );
    for (const edge of project.edges) {
      const sourceInside = memberIds.has(edge.source);
      const targetInside = memberIds.has(edge.target);
      if (sourceInside === targetInside) {
        continue;
      }
      const side = targetInside ? "input" : "output";
      const port = portFromEdge(edge, side);
      const key = `${port.kind}:${port.resourceId}`;
      const seen = targetInside ? seenInputs : seenOutputs;
      if (!seen.has(key) && !coveredBy(side, port)) {
        seen.add(key);
        (targetInside ? inputs : outputs).push(port);
      }
    }

    summaries.set(pocket.id, {
      inputs,
      outputs,
      // Crop cards count the harvesters their crops fill, not seeds.
      machineCount: nodes.reduce(
        (sum, node) => sum + getNodeMachineBuildCount(recipesById.get(node.recipeId), node),
        0,
      ),
      memberCount: memberIds.size,
    });
  }

  return summaries;
}

const RATE_EPSILON = 1e-6;

/**
 * Which rendered port a crossing wire docks on.
 *
 * The card draws one row per resource and merges compatible forms, so a wire
 * stored against a concrete form has to find the row its oredict sibling
 * kept. The board's edge remap and the card must agree here, or a wire
 * anchors to a port that was never drawn and simply vanishes.
 */
export function resolvePocketPortHandleId(
  project: FactoryProject,
  summary: PocketSummary | undefined,
  pocketId: string,
  side: "input" | "output",
  resource: { kind: ResourceBalance["kind"]; id: string },
): string | undefined {
  const ports = side === "input" ? summary?.inputs : summary?.outputs;
  if (!ports || ports.length === 0) {
    return undefined;
  }

  const exact = ports.find(
    (port) => port.kind === resource.kind && port.resourceId === resource.id,
  );
  const chosen =
    exact ??
    (() => {
      const entries = listPocketPortResources(project, pocketId, side);
      return ports.find((port) => {
        const entry = entries.find(
          (candidate) => candidate.kind === port.kind && candidate.id === port.resourceId,
        );
        return entry ? resourceMatchesInput(resource, entry) : false;
      });
    })();

  return chosen
    ? makeResourceHandleId(side, { kind: chosen.kind, id: chosen.resourceId })
    : undefined;
}

/**
 * A pocket's ports as RAIL ports — the same surface a machine card wears.
 *
 * Two numbers meet on every row, and they come from opposite places. The
 * nameplate is what the dimension could move if it got everything it asked
 * for, and that is not a usage multiply: it is the scoped solve in
 * `computePocketSummaries`, a real simulation of every machine inside with
 * the outside world unhooked. The current rate is what it is ACTUALLY moving
 * right now, read straight out of the plan-wide solve — pocket members never
 * leave the flat graph, so the solver has been simulating them, with their
 * real supply, all along. Nobody was reading it.
 *
 * So a starved pocket now reads exactly like a starved machine: 12 / 30 a
 * second, bar a third full, and the row tinted for why.
 */
export function buildPocketRailPorts(
  project: FactoryProject,
  result: ThroughputResult | undefined,
  pocketId: string,
  summary: PocketSummary,
): { inputs: RailPort[]; outputs: RailPort[] } {
  const members = collectPocketMembers(project, pocketId);
  const memberIds = new Set<string>([
    ...members.nodes.map((node) => node.id),
    ...members.storages.map((storage) => storage.id),
  ]);

  // What the machines inside are really moving. A node's flow figures are
  // NAMEPLATE rates - what the machine would move at full blast - so each one
  // is scaled by how hard that machine is actually running, exactly as a
  // machine card scales its own output chip. Netting the two sides is what
  // makes an ingredient the dimension makes for itself stop counting as a
  // boundary need.
  const produced = new Map<string, number>();
  const consumed = new Map<string, number>();
  for (const member of members.nodes) {
    const memberResult = result?.nodes[member.id];
    if (!memberResult) {
      continue;
    }
    const running = Math.min(Math.max(memberResult.utilization ?? 0, 0), 1);
    for (const flow of Object.values(memberResult.outputs)) {
      produced.set(flow.key, (produced.get(flow.key) ?? 0) + flow.amountPerSecond * running);
    }
    for (const flow of Object.values(memberResult.inputs)) {
      consumed.set(flow.key, (consumed.get(flow.key) ?? 0) + flow.amountPerSecond * running);
    }
  }

  const nodesById = new Map(project.nodes.map((node) => [node.id, node] as const));
  const recipesById = new Map(project.recipes.map((recipe) => [recipe.id, recipe] as const));
  const storagesById = new Map(
    (project.storages ?? []).map((storage) => [storage.id, storage] as const),
  );
  const farEndName = (id: string): string => {
    const node = nodesById.get(id);
    if (node) {
      const recipe = recipesById.get(node.recipeId);
      return recipe?.machineType ?? recipe?.name ?? "Machine";
    }
    const storage = storagesById.get(id);
    return storage ? describeStorage(storage, getStorageRole(project, storage.id)) : "Card";
  };

  const buildSide = (side: "input" | "output"): RailPort[] => {
    const isInput = side === "input";
    const ports = isInput ? summary.inputs : summary.outputs;

    // Every crossing wire is bucketed onto its row ONCE, not re-resolved for
    // each port: a pocket holding a thousand machines behind a dozen ports
    // would otherwise walk the edge list a dozen times over, and resolution
    // itself walks the members.
    const edgesByHandle = new Map<string, FactoryEdge[]>();
    for (const edge of project.edges) {
      const inside = isInput ? memberIds.has(edge.target) : memberIds.has(edge.source);
      const outside = isInput ? !memberIds.has(edge.source) : !memberIds.has(edge.target);
      if (!inside || !outside) {
        continue;
      }
      const stored = parseResourceHandleId(isInput ? edge.targetHandle : edge.sourceHandle);
      const docked = resolvePocketPortHandleId(project, summary, pocketId, side, {
        kind: stored?.kind ?? edge.resourceKind,
        id: stored?.resourceId ?? edge.resourceId,
      });
      if (docked) {
        const bucket = edgesByHandle.get(docked);
        if (bucket) {
          bucket.push(edge);
        } else {
          edgesByHandle.set(docked, [edge]);
        }
      }
    }

    return ports.map((port) => {
      const key = makeResourceKey(port.kind, port.resourceId);
      const handleId = makeResourceHandleId(side, { kind: port.kind, id: port.resourceId });
      const edges = edgesByHandle.get(handleId) ?? [];
      const connected = edges.length > 0;

      let transferred = 0;
      let available = 0;
      let lineAsk = 0;
      const farEnds = new Set<string>();
      for (const edge of edges) {
        const edgeResult = result?.edges[edge.id];
        transferred += edgeResult?.transferredPerSecond ?? 0;
        available += edgeResult?.availablePerSecond ?? edgeResult?.transferredPerSecond ?? 0;
        lineAsk += edgeResult?.nameplateDemandPerSecond ?? edgeResult?.demandPerSecond ?? 0;
        farEnds.add(isInput ? edge.source : edge.target);
      }

      // Net flow across the boundary for this resource, from the REAL solve.
      const net = (produced.get(key) ?? 0) - (consumed.get(key) ?? 0);
      const currentPerSecond = Math.max(0, isInput ? -net : net);
      // The scoped solve's figure is the nameplate. A row that exists only
      // because a wire crosses here has no scoped figure (it carries 0), so
      // it falls back to what is actually moving rather than drawing a bar
      // against nothing.
      const nameplatePerSecond =
        port.ratePerSecond > RATE_EPSILON
          ? port.ratePerSecond
          : Math.max(currentPerSecond, isInput ? lineAsk : transferred);

      const short = currentPerSecond + RATE_EPSILON < nameplatePerSecond;
      const fillFraction =
        nameplatePerSecond > RATE_EPSILON
          ? Math.min(currentPerSecond / nameplatePerSecond, 1)
          : connected
            ? 1
            : 0;

      let tone: RailPort["tone"] = "ok";
      if (isInput && !connected) {
        tone = "idle";
      } else if (short) {
        tone = isInput ? "bind" : "slowed";
      }

      let plug: RailPort["plug"];
      if (!isInput && connected) {
        const ask = lineAsk > RATE_EPSILON ? lineAsk : transferred;
        const covered = ask > RATE_EPSILON ? Math.min(transferred / ask, 1) : 1;
        plug = {
          // Askers want more than they get: blame the dimension when it is
          // running short of its own nameplate, the askers when it is not.
          state:
            transferred + RATE_EPSILON >= ask ? "fed" : short ? "blocked" : "hungry",
          askerName:
            farEnds.size === 1 ? farEndName([...farEnds][0]!) : `${farEnds.size} machines`,
          askerMachines: farEnds.size,
          askPerSecond: ask,
          getPerSecond: transferred,
          coveredFraction: covered,
          timesShort:
            transferred > RATE_EPSILON ? ask / transferred : ask > RATE_EPSILON ? Infinity : undefined,
        };
      }

      return {
        side,
        key: `${side}:${key}`,
        kind: port.kind,
        resourceId: port.resourceId,
        displayName: port.displayName ?? port.resourceId,
        handleId,
        resource: {
          kind: port.kind,
          id: port.resourceId,
          amount: 1,
          displayName: port.displayName,
          iconPath: port.iconPath,
          iconAtlas: port.iconAtlas,
          dominantColor: port.dominantColor,
        },
        connected,
        // A consumed input with no line on it is fed by hand, exactly as on a
        // machine card. Pockets never said so before.
        unsupplied: isInput && !connected,
        currentPerSecond,
        nameplatePerSecond,
        wantedPerSecond: isInput ? nameplatePerSecond : connected ? lineAsk : 0,
        couldPerSecond: isInput ? (connected ? available : nameplatePerSecond) : nameplatePerSecond,
        fillFraction,
        tone,
        plug,
        // Both halves whenever they differ: "what it is moving / what it
        // could move" is the entire question a pocket card was not answering.
        showNameplate: short,
      } satisfies RailPort;
    });
  };

  return { inputs: buildSide("input"), outputs: buildSide("output") };
}

type ResourceIconMeta = Pick<
  ResourceAmount,
  "displayName" | "iconPath" | "iconAtlas" | "dominantColor"
>;

function buildResourceIconLookup(project: FactoryProject): Map<string, ResourceIconMeta> {
  const icons = new Map<string, ResourceIconMeta>();
  const add = (resource: Pick<ResourceAmount, "kind" | "id"> & ResourceIconMeta) => {
    const key = `${resource.kind}:${resource.id}`;
    const existing = icons.get(key);
    if (!existing || (!existing.iconPath && resource.iconPath)) {
      icons.set(key, resource);
    }
  };

  for (const recipe of project.recipes) {
    for (const resource of [...recipe.inputs, ...recipe.outputs]) {
      add(resource);
    }
  }
  for (const storage of project.storages ?? []) {
    add({
      kind: storage.kind,
      id: storage.resourceId,
      displayName: storage.displayName,
      iconPath: storage.iconPath,
      iconAtlas: storage.iconAtlas,
      dominantColor: storage.dominantColor,
    });
  }
  return icons;
}
