import type { FactoryProject, PlanTaskSourcePlan } from "@/lib/model/types";
import type { TaskCard } from "./make-task";
import { addThing, cardLine, taskById } from "./task-board";

/** A checked quantity still covers a smaller requirement for the same machine and tier. */
function stillBuilt(before: string, card: TaskCard): boolean {
  if (before === cardLine(card)) return true;
  const match = /^([1-9]\d*)× /.exec(before);
  if (!match) return false;
  const built = Number(match[1]);
  return (
    Number.isSafeInteger(built) &&
    card.count >= 0 &&
    card.count < built &&
    before === cardLine({ ...card, count: built })
  );
}

/** Refresh one source plan's machines; equal or smaller requirements keep their checkmarks. */
export function syncTaskPlan(
  project: FactoryProject,
  taskId: string,
  source: PlanTaskSourcePlan,
  planIds: readonly string[],
  cards: readonly TaskCard[],
): FactoryProject {
  const task = taskById(project, taskId);
  const aliases = new Set([source.plan, ...planIds]);
  if (!task?.sourcePlans?.some((entry) => aliases.has(entry.plan))) return project;
  const machines = new Map(cards.map((card) => [card.nodeId, card]));
  const same = <T>(before: readonly T[] | undefined, after: readonly T[]) =>
    (before?.length ?? 0) === after.length && after.every((entry, at) => entry === before?.[at]);
  const seen = new Set<string>();
  const taskItems = (project.taskItems ?? []).flatMap((item) => {
    if (item.taskId !== taskId || !item.link || !aliases.has(item.link.plan)) return [item];
    const card = machines.get(item.link.node);
    if (!card || seen.has(card.nodeId)) return [];
    seen.add(card.nodeId);
    const text = cardLine(card);
    if (item.text === text && item.link.plan === source.plan) return [item];
    return [
      {
        ...item,
        text,
        done: item.done && stillBuilt(item.text, card),
        link: { plan: source.plan, node: card.nodeId },
      },
    ];
  });
  let recorded = false;
  const sourcePlans = task.sourcePlans.flatMap((entry) => {
    if (!aliases.has(entry.plan)) return [entry];
    if (recorded) return [];
    recorded = true;
    return [entry.plan === source.plan && entry.name === source.name ? entry : source];
  });
  // Checklist rows replace this source's legacy links, including aliases that would otherwise count twice.
  const links = task.links?.filter((link) => !aliases.has(link.plan));
  const sameTask = same(task.sourcePlans, sourcePlans) && (!links || same(task.links, links));
  const sameItems = same(project.taskItems, taskItems);
  let next = project;
  if (!sameTask || !sameItems) {
    next = {
      ...project,
      ...(sameItems ? {} : { taskItems }),
      tasks: sameTask
        ? project.tasks
        : project.tasks?.map((entry) =>
            entry.id !== taskId
              ? entry
              : {
                  ...entry,
                  sourcePlans,
                  ...(entry.links ? { links } : {}),
                },
          ),
    };
  }
  for (const card of cards) {
    if (!seen.has(card.nodeId)) {
      next = addThing(next, taskId, {
        kind: "machine",
        text: cardLine(card),
        link: { plan: source.plan, node: card.nodeId },
      });
    }
  }
  return next;
}
