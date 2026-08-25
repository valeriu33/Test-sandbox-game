/**
 * A tiny stateless behaviour tree.
 *
 * The whole tree is re-evaluated from the root every tick, so guard
 * conditions are re-checked continuously and a high-priority branch (fleeing
 * a wolf, starving) preempts whatever the entity was doing — no explicit
 * state transition required. That is the key difference from the state
 * machine this replaces, where an entity could only reconsider once its
 * current action ran to completion.
 *
 * Anything that must survive between ticks — the berry bush being walked to,
 * the current movement target — lives on the entity itself, not in the tree,
 * which is what lets the tree stay stateless and shared between all entities.
 */

export type BehStatus = 'success' | 'fail' | 'running';

export interface BehContext {
  /** Label of the leaf that last did something. Drives the inspector card. */
  activity: string;
}

export interface BehNode<C extends BehContext> {
  readonly name: string;
  run(ctx: C): BehStatus;
}

/**
 * A leaf that does something. Its name doubles as the human-readable label
 * shown in the inspector, so it is written for the player, not the debugger.
 */
export function action<C extends BehContext>(
  name: string,
  fn: (ctx: C) => BehStatus,
): BehNode<C> {
  return {
    name,
    run(ctx) {
      const status = fn(ctx);
      if (status !== 'fail') ctx.activity = name;
      return status;
    },
  };
}

/** Runs children in order; stops at the first that fails or is still running. */
export function sequence<C extends BehContext>(
  name: string,
  ...children: BehNode<C>[]
): BehNode<C> {
  return {
    name,
    run(ctx) {
      for (const child of children) {
        const status = child.run(ctx);
        if (status !== 'success') return status;
      }
      return 'success';
    },
  };
}

/** Runs children in order; stops at the first that succeeds or is running. */
export function selector<C extends BehContext>(
  name: string,
  ...children: BehNode<C>[]
): BehNode<C> {
  return {
    name,
    run(ctx) {
      for (const child of children) {
        const status = child.run(ctx);
        if (status !== 'fail') return status;
      }
      return 'fail';
    },
  };
}

/** Gates a subtree behind a predicate — the shape most branches here take. */
export function guard<C extends BehContext>(
  name: string,
  when: (ctx: C) => boolean,
  child: BehNode<C>,
): BehNode<C> {
  return {
    name,
    run: (ctx) => (when(ctx) ? child.run(ctx) : 'fail'),
  };
}
