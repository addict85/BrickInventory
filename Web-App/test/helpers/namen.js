/**
 * Ist ein Funktionsname englisch? Gezählt wird das erste Wort (das Verb), weil
 * es den Namen trägt: `fetchPrice`, `getSetInfo`, `isDecodable`. „set“ allein
 * zählt nicht, es ist im Bereich das (LEGO-)Set (`setErfassen`); englisch ist
 * es erst mit einem englischen Wort danach (`setUserSetting`).
 */
const VERBEN = new Set(
  (
    'get add update delete remove fetch build load check record ensure move refresh run create parse resolve ' +
    'compute find send purge handle apply clean cleanup sync generate download upload import export sanitize ' +
    'normalize validate calculate convert format render read write save list count clear reset start stop track ' +
    'trigger estimate enrich is has can should make init open close require serve stream emit invalidate verify ' +
    'issue revoke rotate lookup match insert store mark attach detach notify schedule process collect compare ' +
    'merge split filter map sort pick extract encode decode hash sign wrap unwrap acquire release lock unlock ' +
    'touch persist restore replace use with to from describe plan query search scan set'
  ).split(' '),
);
const ENGLISCH_NACH_SET = /^set(?:User|Global|Setting|Status|Job|Up|Default|Value|Cache|Price|State)/;

function englischerName(/** @type {string} */ name) {
  const erstes = (/^[a-z]+/.exec(name) || [''])[0];
  if (erstes === 'set') return ENGLISCH_NACH_SET.test(name);
  return VERBEN.has(erstes);
}

module.exports = { englischerName };
