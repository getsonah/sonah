// H1. The carry version the run profile binds moved from `sonah.carry/4` to
// `sonah.carry/5` (carry.js `longTail`: a result's tail size is read from the record only). Rendering it back lets a
// byte-pin test that renders an older profile back (M33 H, M33 N) keep proving that nothing else of the profile moved.
export const CARRY_VERSIONS = Object.freeze({ before: 'sonah.carry/4', after: 'sonah.carry/5' });

/** A run profile with its carry version rendered back to `sonah.carry/4`; any other profile unchanged. */
export function profileBeforeCarry5(profile) {
  const copy = structuredClone(profile);
  if (copy?.carry?.version === CARRY_VERSIONS.after) copy.carry.version = CARRY_VERSIONS.before;
  return copy;
}
