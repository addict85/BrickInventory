/** The area's public face: others import only from here, the cut below stays free. */
export { assetlinks } from './androidApp';
export { relyingParty } from './passkeys';
export type { PasskeyPurpose } from './passkeys';
export { otpauthAddress } from './secondFactor';
export { createFactors } from './area';
export type { FactorsServices, FactorsContext } from './area';
