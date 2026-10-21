import { z } from "zod";
import type { ResourceAmount, ResourceKind } from "@/lib/model/types";

export const sharingSchema = z.enum(["internal", "import", "export", "both"]);
const id = z.string().min(1).max(160);
export const memberSchema = z.object({
  designId: id,
  ownerId: id.optional(),
  name: z.string().max(80),
  included: z.boolean(),
  group: z.string().trim().min(1).max(80).optional(),
  portSelection: z.array(z.string().min(1).max(2048)).max(10000).optional(),
});
export const networkSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80),
  parentId: id.optional(),
  included: z.boolean(),
  members: z.array(memberSchema).max(500),
  selfPowered: z.boolean().optional(),
  groups: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
  sharing: z.record(z.string().max(512), sharingSchema),
});
export type Sharing = z.infer<typeof sharingSchema>;
export type NetworkMember = z.infer<typeof memberSchema>;
export type PlanNetwork = z.infer<typeof networkSchema>;
export const memberKey = (member: Pick<NetworkMember, "designId" | "ownerId">): string =>
  JSON.stringify([member.ownerId ?? "", member.designId]);

/** The whole topology is validated and saved together: moves cannot leave a plan in two places. */
export const catalogueSchema = z
  .array(networkSchema)
  .max(200)
  .superRefine((networks, ctx) => {
    const byId = new Map(networks.map((network) => [network.id, network]));
    const members = new Set<string>();
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (byId.size !== networks.length) fail("Network ids must be unique.");
    for (const network of networks) {
      const visited = new Set([network.id]);
      let parent = network.parentId;
      while (parent) {
        if (visited.has(parent)) {
          fail("Networks cannot contain a cycle.");
          break;
        }
        visited.add(parent);
        const entry = byId.get(parent);
        if (!entry) {
          fail("The parent network is missing.");
          break;
        }
        parent = entry.parentId;
      }
      for (const member of network.members) {
        const key = memberKey(member);
        if (members.has(key)) fail("A plan can belong to only one network.");
        members.add(key);
      }
    }
  });

export interface MaterialFlow extends Pick<
  ResourceAmount,
  "iconPath" | "iconAtlas" | "dominantColor"
> {
  key: string;
  kind: ResourceKind;
  resourceId: string;
  label: string;
  supply: number;
  demand: number;
}
export interface PlanFlows {
  materials: MaterialFlow[];
  ports?: NetworkPortFlow[];
  power: { used: number; made: number };
  error?: string;
  stale?: boolean;
}
export interface NetworkPortFlow extends MaterialFlow {
  portKey: string;
  machine: string;
  side: "in" | "out";
}

export function selectedMaterials(plan: PlanFlows, selection?: string[]): MaterialFlow[] {
  if (selection === undefined) return plan.materials;
  const selected = new Set(selection);
  const rows = new Map<string, MaterialFlow>();
  for (const port of plan.ports ?? []) {
    if (!selected.has(port.portKey) || (!port.supply && !port.demand)) continue;
    const row = rows.get(port.key) ?? { ...port, supply: 0, demand: 0 };
    row.supply += port.supply;
    row.demand += port.demand;
    rows.set(port.key, row);
  }
  return [...rows.values()];
}
export interface Contribution {
  id: string;
  name: string;
  network: boolean;
  supply: number;
  demand: number;
}
export interface NetworkResource extends MaterialFlow {
  free: number;
  shortage: number;
  fromParent: number;
  toParent: number;
  contributions: Contribution[];
}
export interface NetworkBalance {
  resources: NetworkResource[];
  power: { used: number; made: number };
  incomplete: string[];
}

/** Boundary flows only enter a parent once; a child's private production never enters these sums. */
export function aggregateNetworks(
  networks: PlanNetwork[],
  plans: ReadonlyMap<string, PlanFlows>,
): Map<string, NetworkBalance> {
  const answers = new Map<string, NetworkBalance>();
  const children = new Map<string, PlanNetwork[]>();
  for (const network of networks) {
    if (network.parentId)
      children.set(network.parentId, [...(children.get(network.parentId) ?? []), network]);
  }
  const visit = (network: PlanNetwork): NetworkBalance => {
    const rows = new Map<string, NetworkResource>();
    const answer: NetworkBalance = { resources: [], power: { used: 0, made: 0 }, incomplete: [] };
    const add = (flow: MaterialFlow, contribution: Omit<Contribution, "supply" | "demand">) => {
      let row = rows.get(flow.key);
      if (!row) {
        row = {
          ...flow,
          supply: 0,
          demand: 0,
          free: 0,
          shortage: 0,
          fromParent: 0,
          toParent: 0,
          contributions: [],
        };
        rows.set(flow.key, row);
      }
      if (!row.iconPath && !row.iconAtlas) {
        row.iconPath = flow.iconPath;
        row.iconAtlas = flow.iconAtlas;
      }
      row.dominantColor ??= flow.dominantColor;
      row.supply += flow.supply;
      row.demand += flow.demand;
      row.contributions.push({ ...contribution, supply: flow.supply, demand: flow.demand });
    };
    for (const member of network.members) {
      if (!member.included) continue;
      const key = memberKey(member);
      const plan = plans.get(key);
      if (!plan || plan.error || plan.stale)
        answer.incomplete.push(
          `${member.name}: ${plan?.error ?? (plan?.stale ? "outdated figures" : "calculating or unavailable")}`,
        );
      if (!plan || plan.error) continue;
      if (
        member.portSelection?.some((port) => !plan.ports?.some((entry) => entry.portKey === port))
      )
        answer.incomplete.push(`${member.name}: selected ports are unavailable`);
      selectedMaterials(plan, member.portSelection).forEach((flow) =>
        add(flow, { id: key, name: member.name, network: false }),
      );
      answer.power.used += plan.power.used;
      answer.power.made += plan.power.made;
    }
    for (const child of children.get(network.id) ?? []) {
      const result = visit(child);
      if (!child.included) continue;
      if (result.incomplete.length) answer.incomplete.push(`${child.name}: incomplete figures`);
      for (const flow of result.resources) {
        if (flow.toParent || flow.fromParent)
          add(
            { ...flow, supply: flow.toParent, demand: flow.fromParent },
            { id: child.id, name: child.name, network: true },
          );
      }
      // A separate power supply stays inside the child's boundary, like private materials.
      if (!child.selfPowered) {
        answer.power.used += result.power.used;
        answer.power.made += result.power.made;
      }
    }
    for (const row of rows.values()) {
      const tolerance = Math.max(1e-6, Math.max(row.supply, row.demand) * 1e-5);
      const net = Math.abs(row.supply - row.demand) <= tolerance ? 0 : row.supply - row.demand;
      row.free = Math.max(0, net);
      row.shortage = Math.max(0, -net);
      const sharing = network.sharing[row.key] ?? "internal";
      if (network.parentId && (sharing === "import" || sharing === "both"))
        row.fromParent = row.shortage;
      if (network.parentId && (sharing === "export" || sharing === "both")) row.toParent = row.free;
    }
    answer.resources = [...rows.values()].sort((a, b) => a.label.localeCompare(b.label));
    answers.set(network.id, answer);
    return answer;
  };
  networks.filter((network) => !network.parentId).forEach(visit);
  return answers;
}

export function removeNetwork(networks: PlanNetwork[], id: string): PlanNetwork[] {
  const parentId = networks.find((network) => network.id === id)?.parentId;
  return networks
    .filter((network) => network.id !== id)
    .map((network) => (network.parentId === id ? { ...network, parentId } : network));
}

/** A covered import is not a shortage. A scarce parent has no per-child allocation to report. */
export function unmetDemand(
  networks: PlanNetwork[],
  balances: ReadonlyMap<string, NetworkBalance>,
  networkId: string,
  key: string,
): number | undefined {
  const network = networks.find((entry) => entry.id === networkId);
  const row = balances.get(networkId)?.resources.find((entry) => entry.key === key);
  if (!network || !row || !row.shortage) return 0;
  if (!row.fromParent || !network.parentId || !network.included) return row.shortage;
  if (balances.get(network.parentId)?.incomplete.length) return undefined;
  return unmetDemand(networks, balances, network.parentId, key) === 0 ? 0 : undefined;
}
