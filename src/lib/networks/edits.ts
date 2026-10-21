import { memberKey, type NetworkMember, type PlanNetwork } from "./model";

export type NetworkChange = (network: PlanNetwork) => PlanNetwork;

/** Apply changes to the queued catalogue, so rapid edits never restore an older member list. */
export function updateNetwork(
  networks: PlanNetwork[],
  id: string,
  change: NetworkChange,
): PlanNetwork[] {
  return networks.map((network) => (network.id === id ? change(network) : network));
}

export function networkGroups(network: PlanNetwork): string[] {
  return [
    ...new Set([
      ...(network.groups ?? []),
      ...network.members.flatMap((member) => (member.group ? [member.group] : [])),
    ]),
  ].sort((a, b) => a.localeCompare(b));
}

export function updateMember(key: string, values: Partial<NetworkMember>): NetworkChange {
  return (network) => ({
    ...network,
    members: network.members.map((member) =>
      memberKey(member) === key ? { ...member, ...values } : member,
    ),
  });
}

export function removeMember(key: string): NetworkChange {
  return (network) => ({
    ...network,
    members: network.members.filter((member) => memberKey(member) !== key),
  });
}

export function moveMember(key: string, group: string | undefined): NetworkChange {
  return (network) => ({
    ...updateMember(key, { group })(network),
    groups: networkGroups(network),
  });
}

export function saveGroup(name: string, previous?: string): NetworkChange {
  return (network) => ({
    ...network,
    groups: [
      ...new Set([
        ...networkGroups(network).map((group) => (group === previous ? name : group)),
        name,
      ]),
    ],
    members: network.members.map((member) =>
      previous && member.group === previous ? { ...member, group: name } : member,
    ),
  });
}

export function removeGroup(group: string): NetworkChange {
  return (network) => ({
    ...network,
    groups: networkGroups(network).filter((name) => name !== group),
    members: network.members.map((member) =>
      member.group === group ? { ...member, group: undefined } : member,
    ),
  });
}
