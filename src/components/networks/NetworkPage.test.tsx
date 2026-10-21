// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useNetworkStore } from "@/store/network-store";
import { useFactoryStore } from "@/store/factory-store";
import { useDesignStore } from "@/store/design-store";
import { memberKey, type PlanFlows, type PlanNetwork } from "@/lib/networks/model";
import { NetworkPage } from "./NetworkPage";
import * as deviceSettings from "@/lib/device-settings";

const mocks = vi.hoisted(() => ({ flows: new Map<string, PlanFlows>() }));
vi.mock("@/lib/networks/calculation", () => ({
  useNetworkCalculations: () => mocks.flows,
  localDesignId: (member: { designId: string }) => member.designId,
}));

const originalEdit = useNetworkStore.getState().edit;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useNetworkStore.setState({ edit: originalEdit });
});

it("wheel-steps time and sharing, clamps at the ends and respects the scroll preference", () => {
  const preference = vi.spyOn(deviceSettings, "wheelChangesValues").mockReturnValue(true);
  useNetworkStore.setState((state) => ({
    catalogue: {
      ...state.catalogue!,
      networks: [
        { id: "parent", name: "Parent", included: true, members: [], sharing: {} },
        { ...state.catalogue!.networks[0], parentId: "parent" },
      ],
    },
  }));
  const solve = useFactoryStore.getState().lastResult;
  render(<NetworkPage />);
  const time = screen.getByRole("combobox", { name: "Rate unit" });
  expect(fireEvent.wheel(time, { deltaY: -100, cancelable: true })).toBe(false);
  expect(useFactoryStore.getState().rateUnit).toBe("minute");
  fireEvent.wheel(time, { deltaY: -100 });
  fireEvent.wheel(time, { deltaY: -100 });
  expect(useFactoryStore.getState().rateUnit).toBe("hour");
  fireEvent.wheel(time, { deltaY: 100 });
  expect(useFactoryStore.getState().rateUnit).toBe("minute");
  const sharing = screen.getByRole("combobox", { name: "Sharing for Oxygen" });
  fireEvent.wheel(sharing, { deltaY: -100 });
  expect(useNetworkStore.getState().catalogue!.networks[1].sharing["fluid:oxygen"]).toBe("import");
  fireEvent.wheel(sharing, { deltaY: 100 });
  expect(useNetworkStore.getState().catalogue!.networks[1].sharing["fluid:oxygen"]).toBe(
    "internal",
  );
  preference.mockReturnValue(false);
  expect(fireEvent.wheel(time, { deltaY: -100, cancelable: true })).toBe(true);
  fireEvent.wheel(sharing, { deltaY: -100 });
  expect(useFactoryStore.getState().rateUnit).toBe("minute");
  expect(useNetworkStore.getState().catalogue!.networks[1].sharing["fluid:oxygen"]).toBe(
    "internal",
  );
  expect(useFactoryStore.getState().lastResult).toBe(solve);
});

it("offers self-powered only for a subnet and saves its explicit choice", () => {
  const view = render(<NetworkPage />);
  expect(screen.queryByRole("checkbox", { name: "Self-powered" })).toBeNull();
  view.unmount();
  useNetworkStore.setState((state) => ({
    catalogue: {
      ...state.catalogue!,
      networks: [
        { id: "parent", name: "Parent", included: true, members: [], sharing: {} },
        { ...state.catalogue!.networks[0], parentId: "parent" },
      ],
    },
  }));
  render(<NetworkPage />);
  fireEvent.click(screen.getByText("Network settings"));
  const toggle = screen.getByRole("checkbox", { name: "Self-powered" });
  expect((toggle as HTMLInputElement).checked).toBe(false);
  fireEvent.click(toggle);
  expect(useNetworkStore.getState().catalogue!.networks[1].selfPowered).toBe(true);
  fireEvent.click(toggle);
  expect(useNetworkStore.getState().catalogue!.networks[1].selfPowered).toBe(false);
});

beforeEach(() => {
  deviceSettings.writeDeviceSettings({ networkSidebarWidth: 300 });
  const member = { designId: "line", name: "Line", included: true };
  const material = {
    key: "fluid:oxygen",
    kind: "fluid" as const,
    resourceId: "oxygen",
    label: "Oxygen",
    supply: 10,
    demand: 0,
  };
  mocks.flows = new Map([
    [
      memberKey(member),
      {
        materials: [material],
        ports: [{ ...material, portKey: "out", machine: "Machine", side: "out" }],
        power: { used: 0, made: 0 },
      },
    ],
  ]);
  useFactoryStore.getState().setRateUnit("second");
  useNetworkStore.setState({
    activeId: "main",
    ready: true,
    saving: 0,
    syncing: undefined,
    error: undefined,
    conflict: undefined,
    edit: vi.fn(async (change) =>
      useNetworkStore.setState((state) => ({
        catalogue: { ...state.catalogue!, networks: change(state.catalogue!.networks) },
      })),
    ),
    catalogue: {
      account: "local",
      token: "t",
      revision: 0,
      dirty: false,
      networks: [{ id: "main", name: "Main", included: true, members: [member], sharing: {} }],
    },
  });
});

it("resizes the sidebar with keys and resets it with a double click", () => {
  render(<NetworkPage />);
  const handle = screen.getByRole("separator", { name: "Resize network plan list" });
  fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
  expect(deviceSettings.readDeviceSettings().networkSidebarWidth).toBe(364);
  fireEvent.keyDown(handle, { key: "Home" });
  expect(deviceSettings.readDeviceSettings().networkSidebarWidth).toBe(240);
  fireEvent.doubleClick(handle);
  expect(deviceSettings.readDeviceSettings().networkSidebarWidth).toBe(300);
});

it("shows self-powered status in the tree and power summary and explains sharing direction", () => {
  useNetworkStore.setState((state) => ({
    catalogue: {
      ...state.catalogue!,
      networks: [
        { id: "parent", name: "Parent", included: true, members: [], sharing: {} },
        { ...state.catalogue!.networks[0], parentId: "parent", selfPowered: true },
      ],
    },
  }));
  render(<NetworkPage />);
  expect(screen.getAllByRole("img", { name: "Self-powered" })).toHaveLength(2);
  const sharing = screen.getByRole("combobox", { name: "Sharing for Oxygen" });
  expect(sharing.title).toContain("no resources cross");
  fireEvent.change(sharing, { target: { value: "import" } });
  expect(sharing.title).toContain("Import from parent");
});

it("opens I/O as a modal, traps focus and closes with Escape", () => {
  render(<NetworkPage />);
  const trigger = screen.getByRole("button", { name: "Inputs and outputs for Line" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Inputs and outputs · Line" });
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(dialog.contains(document.activeElement)).toBe(true);
  const close = screen.getByRole("button", { name: "Close" });
  expect(within(dialog).queryByRole("button", { name: "Done" })).toBeNull();
  // Last checkbox wraps Tab back to the first control.
  const checkbox = screen.getByRole("checkbox", { name: /Output · Oxygen/ });
  checkbox.focus();
  fireEvent.keyDown(document, { key: "Tab" });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "About network ports" }));
  expect(close).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("counts selected ports per machine and keeps collapsed sections and selections independent", () => {
  const flow = mocks.flows.values().next().value!;
  const port = flow.ports![0];
  flow.ports = [
    port,
    { ...port, portKey: "in", side: "in", supply: 0, demand: 5 },
    { ...port, key: "fluid:hydrogen", resourceId: "hydrogen", label: "Hydrogen" },
    { ...port, portKey: "other", machine: "Other machine" },
  ];
  render(<NetworkPage />);
  fireEvent.click(screen.getByRole("button", { name: "Inputs and outputs for Line" }));
  const modal = screen.getByRole("dialog");
  const headings = modal.querySelectorAll<HTMLElement>(".netview-port-machine > summary");
  const first = headings[0].parentElement! as HTMLDetailsElement;
  const second = headings[1].parentElement! as HTMLDetailsElement;
  expect(headings[0].textContent).toBe("Machine2/2 selected");
  expect(headings[1].textContent).toBe("Other machine1/1 selected");
  expect(first.open).toBe(true);
  expect(second.open).toBe(false);
  headings[1].focus();
  fireEvent.keyDown(document.activeElement!, { key: "Tab" });
  expect(document.activeElement).toBe(
    within(modal).getByRole("button", { name: "About network ports" }),
  );
  fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(headings[1]);
  const originalMembers = useNetworkStore.getState().catalogue!.networks[0].members;
  fireEvent.click(headings[0]);
  expect(first.open).toBe(false);
  expect(useNetworkStore.getState().catalogue!.networks[0].members).toBe(originalMembers);
  fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
  expect(headings[0].textContent).toBe("Machine0/2 selected");
  expect(headings[1].textContent).toBe("Other machine0/1 selected");
  expect(first.open).toBe(false);
  fireEvent.click(headings[0]);
  fireEvent.click(within(first).getByRole("checkbox", { name: /Output · Oxygen/ }));
  expect(headings[0].textContent).toBe("Machine1/2 selected");
  // Both resource rows describing the same output follow its single selection.
  expect(
    (within(first).getByRole("checkbox", { name: /Output · Hydrogen/ }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Use all ports" }));
  expect(headings[0].textContent).toBe("Machine2/2 selected");
  expect(headings[1].textContent).toBe("Other machine1/1 selected");
  expect(second.open).toBe(false);
  expect(
    useNetworkStore.getState().catalogue!.networks[0].members[0].portSelection,
  ).toBeUndefined();
});

it("changes rate units without changing the solve and uses compact section actions", () => {
  const result = useFactoryStore.getState().lastResult;
  render(<NetworkPage />);
  expect(screen.queryByRole("button", { name: "Back to networks" })).toBeNull();
  expect(screen.getByRole("button", { name: "Add plans" }).textContent).toBe("");
  expect(screen.getByRole("button", { name: "New subnetwork" }).textContent).toBe("");
  expect(screen.getByRole("button", { name: "New group" }).textContent).toBe("");
  expect(screen.getByRole("button", { name: "Delete network" }).textContent).toBe("");
  fireEvent.change(screen.getByRole("combobox", { name: "Rate unit" }), {
    target: { value: "minute" },
  });
  expect(screen.getAllByText("600 L/min").length).toBeGreaterThan(0);
  expect(useFactoryStore.getState().lastResult).toBe(result);
});

it("organizes plans into collapsible groups without changing totals", () => {
  useNetworkStore.setState((state) => ({
    catalogue: {
      ...state.catalogue!,
      networks: state.catalogue!.networks.map((network) => ({
        ...network,
        groups: ["Oxygen lines"],
      })),
    },
  }));
  render(<NetworkPage />);
  fireEvent.click(screen.getByRole("button", { name: "Inputs and outputs for Line" }));
  const group = screen.getByRole("combobox", { name: "Plan group" });
  fireEvent.change(group, { target: { value: "Oxygen lines" } });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByText("Oxygen lines").closest("details")).toBeTruthy();
  expect(useNetworkStore.getState().catalogue!.networks[0].members[0].group).toBe("Oxygen lines");
  expect(screen.getAllByText("10 L/s").length).toBeGreaterThan(0);
});

it("applies group selections immediately, follows external moves and can return to Ungrouped", () => {
  useNetworkStore.setState((state) => ({
    catalogue: {
      ...state.catalogue!,
      networks: state.catalogue!.networks.map((network) => ({
        ...network,
        groups: ["Source", "Target"],
        members: network.members.map((member) => ({
          ...member,
          group: "Source",
          portSelection: ["out"],
        })),
      })),
    },
  }));
  render(<NetworkPage />);
  fireEvent.click(screen.getByRole("button", { name: "Inputs and outputs for Line" }));
  const picker = screen.getByRole("combobox", { name: "Plan group" }) as HTMLSelectElement;
  expect(picker.tagName).toBe("SELECT");
  expect(picker.value).toBe("Source");
  fireEvent.change(picker, { target: { value: "Target" } });
  expect(useNetworkStore.getState().catalogue!.networks[0].members[0]).toMatchObject({
    group: "Target",
    included: true,
    portSelection: ["out"],
  });
  expect(picker.value).toBe("Target");
  act(() =>
    useNetworkStore.setState((state) => ({
      catalogue: {
        ...state.catalogue!,
        networks: state.catalogue!.networks.map((network) => ({
          ...network,
          members: network.members.map((member) => ({ ...member, group: "Source" })),
        })),
      },
    })),
  );
  expect(picker.value).toBe("Source");
  fireEvent.change(picker, { target: { value: "" } });
  expect(useNetworkStore.getState().catalogue!.networks[0].members[0].group).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Inputs and outputs for Line" }));
  expect((screen.getByRole("combobox", { name: "Plan group" }) as HTMLSelectElement).value).toBe(
    "",
  );
});

it("moves dragged plans into groups and back to Ungrouped while keeping their I/O choices", () => {
  useNetworkStore.setState((state) => ({
    catalogue: {
      ...state.catalogue!,
      networks: [
        {
          ...state.catalogue!.networks[0],
          members: [
            {
              designId: "line",
              name: "Line",
              included: true,
              group: "Source",
              portSelection: ["out"],
            },
            { designId: "other", name: "Other", included: false, group: "Target" },
          ],
        },
      ],
    },
  }));
  render(<NetworkPage />);
  const data = new Map<string, string>();
  const transfer = {
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
    effectAllowed: "",
    dropEffect: "",
  };
  const dragTo = (name: string) => {
    fireEvent.dragStart(screen.getByRole("group", { name: "Draggable plan Line" }), {
      dataTransfer: transfer,
    });
    const target = screen.getByText(name).closest("details")!;
    expect(fireEvent.dragEnter(target, { dataTransfer: transfer })).toBe(false);
    fireEvent.dragOver(target, { dataTransfer: transfer });
    expect(target.hasAttribute("data-drop-target")).toBe(true);
    fireEvent.drop(target, { dataTransfer: transfer });
  };
  dragTo("Target");
  expect(useNetworkStore.getState().catalogue!.networks[0].members[0]).toMatchObject({
    group: "Target",
    included: true,
    portSelection: ["out"],
  });
  dragTo("Ungrouped");
  expect(useNetworkStore.getState().catalogue!.networks[0].members[0].group).toBeUndefined();
  expect(screen.getAllByText("10 L/s").length).toBeGreaterThan(0);
});

it("ignores external drops", () => {
  useNetworkStore.setState((state) => ({
    catalogue: {
      ...state.catalogue!,
      networks: [
        {
          ...state.catalogue!.networks[0],
          members: [{ designId: "line", name: "Line", included: true, group: "Source" }],
        },
      ],
    },
  }));
  render(<NetworkPage />);
  expect(screen.queryByText("Ungrouped")).toBeNull();
  fireEvent.drop(screen.getByText("Source").closest("details")!, {
    dataTransfer: { getData: () => memberKey({ designId: "line" }) },
  });
  expect(useNetworkStore.getState().edit).not.toHaveBeenCalled();
});

it("creates an empty group from a visible control and removes it without removing plans", () => {
  render(<NetworkPage />);
  fireEvent.click(screen.getByRole("button", { name: "New group" }));
  const dialog = screen.getByRole("dialog", { name: "New group" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Group name" }), {
    target: { value: "Chemistry" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create group" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(useNetworkStore.getState().catalogue!.networks[0].groups).toEqual(["Chemistry"]);
  expect(screen.getByText("Chemistry").closest("details")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Options for group Chemistry" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Delete group/ }));
  expect(useNetworkStore.getState().catalogue!.networks[0].groups).toEqual([]);
  expect(useNetworkStore.getState().catalogue!.networks[0].members).toHaveLength(1);
});

it("opens Add plans as a dismissible modal", () => {
  render(<NetworkPage />);
  fireEvent.click(screen.getByRole("button", { name: "Add plans" }));
  expect(screen.getByRole("dialog", { name: "Add plans" }).getAttribute("aria-modal")).toBe("true");
  expect(screen.getByRole("textbox", { name: "Find plans to add" })).toBeTruthy();
  expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Done" })).toBeNull();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("explains an Add plans search with no matches", () => {
  const previous = useDesignStore.getState().designs;
  useDesignStore.setState({
    designs: [{ id: "line", name: "Line", createdAt: "", updatedAt: "" }],
  });
  try {
    render(<NetworkPage />);
    fireEvent.click(screen.getByRole("button", { name: "Add plans" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Find plans to add" }), {
      target: { value: "missing" },
    });
    expect(screen.getByText("No plans match your search.")).toBeTruthy();
  } finally {
    cleanup();
    useDesignStore.setState({ designs: previous });
  }
});

it("filters resource problems and available supply without changing the solve", () => {
  const flow = mocks.flows.values().next().value!;
  const oxygen = flow.materials[0];
  flow.materials.push(
    { ...oxygen, key: "fluid:water", resourceId: "water", label: "Water", supply: 0, demand: 5 },
    {
      ...oxygen,
      key: "fluid:hydrogen",
      resourceId: "hydrogen",
      label: "Hydrogen",
      supply: 3,
      demand: 3,
    },
  );
  const solve = useFactoryStore.getState().lastResult;
  render(<NetworkPage />);
  fireEvent.click(screen.getByRole("button", { name: "1 resource short" }));
  expect(screen.getByRole("button", { name: "Water" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Oxygen" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Available" }));
  expect(screen.getByRole("button", { name: "Oxygen" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Water" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "All" }));
  expect(screen.getByRole("button", { name: "Hydrogen" })).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "Find a resource" }), {
    target: { value: "missing" },
  });
  expect(screen.getByText("No resources match this view.")).toBeTruthy();
  expect(useFactoryStore.getState().lastResult).toBe(solve);
});

it("identifies subnet surplus, filters parent connections and skips imports covered by a parent", () => {
  useNetworkStore.setState((state) => ({
    catalogue: {
      ...state.catalogue!,
      networks: [
        {
          id: "parent",
          name: "Parent",
          members: [],
          sharing: {} as PlanNetwork["sharing"],
          included: true,
        },
        {
          ...state.catalogue!.networks[0],
          parentId: "parent",
          sharing: { "fluid:oxygen": "export" },
        },
      ],
    },
  }));
  render(<NetworkPage />);
  expect(screen.getByRole("columnheader", { name: "Local surplus" }).title).toContain(
    "before consumption elsewhere",
  );
  fireEvent.click(screen.getByRole("button", { name: "Parent connections" }));
  expect(screen.getByRole("button", { name: "Oxygen" })).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "Sharing for Oxygen" }), {
    target: { value: "internal" },
  });
  expect(screen.getByText("No resources match this view.")).toBeTruthy();
});

it("does not mark imports as shortages when the parent covers them", () => {
  const flow = mocks.flows.values().next().value!;
  const oxygen = flow.materials[0];
  flow.materials = [{ ...oxygen, supply: 0, demand: 5 }];
  mocks.flows.set(memberKey({ designId: "producer" }), {
    materials: [oxygen],
    power: { used: 0, made: 0 },
  });
  useNetworkStore.setState((state) => ({
    catalogue: {
      ...state.catalogue!,
      networks: [
        {
          id: "parent",
          name: "Parent",
          members: [{ designId: "producer", name: "Producer", included: true }],
          sharing: {} as PlanNetwork["sharing"],
          included: true,
        },
        {
          ...state.catalogue!.networks[0],
          parentId: "parent",
          sharing: { "fluid:oxygen": "import" },
        },
      ],
    },
  }));
  render(<NetworkPage />);
  expect(screen.queryByRole("button", { name: /resource short/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Shortages" }));
  expect(screen.getByText("No resources match this view.")).toBeTruthy();
});

it("keeps root-only settings relevant and expands resources with the cell's full-width button", () => {
  useNetworkStore.setState((state) => ({
    catalogue: {
      ...state.catalogue!,
      networks: state.catalogue!.networks.map((network) => ({ ...network, included: false })),
    },
  }));
  render(<NetworkPage />);
  expect(screen.queryByText(/Excluded from ancestor totals/)).toBeNull();
  expect((screen.getByText("Network settings").closest("details") as HTMLDetailsElement).open).toBe(
    false,
  );
  fireEvent.click(screen.getByText("Network settings"));
  expect(screen.getByRole("combobox", { name: "Parent network" })).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: "Include in parent totals" })).toBeNull();
  const resource = screen.getByRole("button", { name: "Oxygen" });
  fireEvent.click(resource);
  expect(resource.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getAllByRole("button", { name: "Line" })).toHaveLength(2);
});

it("shows port help on request and distinguishes local saving, syncing and errors", () => {
  render(<NetworkPage />);
  expect(screen.getByRole("status").textContent).toBe("Saved locally");
  act(() => useNetworkStore.setState({ saving: 1 }));
  expect(screen.getByRole("status").textContent).toBe("Saving…");
  act(() => useNetworkStore.setState({ saving: 0, syncing: "request" }));
  expect(screen.getByRole("status").textContent).toBe("Syncing…");
  act(() => useNetworkStore.setState({ syncing: undefined, error: "Save failed" }));
  expect(screen.getByRole("status").textContent).toBe("Changes need attention");
  fireEvent.click(screen.getByRole("button", { name: "Inputs and outputs for Line" }));
  const help = screen.getByRole("button", { name: "About network ports" });
  expect(help.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(help);
  expect(help.getAttribute("aria-expanded")).toBe("true");
  expect(document.getElementById("network-port-help")!.hidden).toBe(false);
});

it("renames a group and its members without changing I/O choices or totals", () => {
  useNetworkStore.setState((state) => ({
    catalogue: {
      ...state.catalogue!,
      networks: [
        {
          ...state.catalogue!.networks[0],
          groups: ["Chemistry"],
          members: [
            {
              designId: "line",
              name: "Line",
              included: true,
              group: "Chemistry",
              portSelection: ["out"],
            },
          ],
        },
      ],
    },
  }));
  render(<NetworkPage />);
  fireEvent.click(screen.getByRole("button", { name: "Options for group Chemistry" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename group" }));
  const dialog = screen.getByRole("dialog", { name: "Rename group" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Group name" }), {
    target: { value: "Oxygen lines" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save name" }));
  expect(useNetworkStore.getState().catalogue!.networks[0]).toMatchObject({
    groups: ["Oxygen lines"],
    members: [{ group: "Oxygen lines", included: true, portSelection: ["out"] }],
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getAllByText("10 L/s").length).toBeGreaterThan(0);
});

it("makes network deletion visible and explains it before confirmation", () => {
  render(<NetworkPage />);
  fireEvent.click(screen.getByRole("button", { name: "Delete network" }));
  const dialog = screen.getByRole("dialog", { name: "Delete Main?" });
  expect(within(dialog).getByText(/Plans are kept/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(useNetworkStore.getState().catalogue!.networks).toHaveLength(1);
});

it("closes the subnet deletion dialog when the parent opens", async () => {
  useNetworkStore.setState((state) => ({
    catalogue: {
      ...state.catalogue!,
      networks: [
        { ...state.catalogue!.networks[0], parentId: "parent" },
        { id: "parent", name: "Parent", included: true, members: [], sharing: {} },
      ],
    },
  }));
  render(<NetworkPage />);
  fireEvent.click(screen.getByRole("button", { name: "Delete network" }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Delete network" }),
  );
  await waitFor(() => expect(useNetworkStore.getState().activeId).toBe("parent"));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("offers I/O and removal in a plan menu, keeping the saved plan when removed", () => {
  render(<NetworkPage />);
  fireEvent.click(screen.getByRole("button", { name: "Options for Line" }));
  expect(screen.getByRole("menu", { name: "Options for Line" })).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitem", { name: "Inputs and outputs" }));
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Options for Line" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Remove from network/ }));
  expect(useNetworkStore.getState().catalogue!.networks[0].members).toEqual([]);
});
