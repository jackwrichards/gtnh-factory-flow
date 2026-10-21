import { describe, expect, it } from "vitest";
import { moveMember, removeGroup, saveGroup, updateMember, updateNetwork } from "./edits";
import { memberKey, type PlanNetwork } from "./model";

const network: PlanNetwork = {
  id: "main",
  name: "Main",
  included: true,
  sharing: {},
  groups: ["Empty"],
  members: [
    { designId: "a", name: "A", included: true, group: "Production", portSelection: ["out"] },
    { designId: "b", name: "B", included: true },
  ],
};

describe("queued network edits", () => {
  it("applies independent member changes to the latest catalogue", () => {
    const first = updateMember(memberKey(network.members[0]!), { included: false });
    const second = updateMember(memberKey(network.members[1]!), { portSelection: [] });
    const saved = updateNetwork(updateNetwork([network], "main", first), "main", second)[0]!;
    expect(saved.members[0]).toMatchObject({ included: false, portSelection: ["out"] });
    expect(saved.members[1]).toMatchObject({ included: true, portSelection: [] });
    expect(network.members[0]!.included).toBe(true);
  });

  it("keeps empty groups and port selections through moves, renames and group removal", () => {
    const moved = moveMember(memberKey(network.members[0]!), undefined)(network);
    expect(moved.groups).toEqual(["Empty", "Production"]);
    const renamed = saveGroup("Water", "Production")(network);
    expect(renamed.members[0]).toMatchObject({ group: "Water", portSelection: ["out"] });
    const removed = removeGroup("Water")(renamed);
    expect(removed.groups).toEqual(["Empty"]);
    expect(removed.members[0]).toMatchObject({ group: undefined, portSelection: ["out"] });
  });
});
