// Jump targets: a lower module opens a view that sits above it (the set detail from an
// acquisition, a view from the router) without importing it. The view registers itself on load;
// an import the other way round would be a cycle in the module graph.

/**
 * @typedef {object} Targets
 * @property {(setNumber: string) => unknown} setDetail     Set's detail dialog
 * @property {(name: string) => unknown} view                Tab or view from the user menu
 * @property {(id: string) => unknown} settingsSection       Section of the settings (registry-exposed name, kept)
 */

/** @type {Partial<Targets>} */
const _targets = {};

/** @param {Partial<Targets>} part */
export function registerTarget(part) {
  Object.assign(_targets, part);
}

/**
 * @template {keyof Targets} K
 * @param {K} name
 * @param {Parameters<Targets[K]>} args
 */
export function jumpTo(name, ...args) {
  const target = /** @type {((...a: Parameters<Targets[K]>) => unknown) | undefined} */ (_targets[name]);
  if (!target) {
    console.warn('[targets] not registered:', name);
    return undefined;
  }
  return target(...args);
}
