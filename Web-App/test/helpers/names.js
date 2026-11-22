/**
 * Is a function name English? What counts is the first word (the verb), because
 * it carries the name: `fetchPrice`, `getSetInfo`, `isDecodable`. “set” alone
 * does not count, in the domain it is the (LEGO) set (`setErfassen`); it is English
 * only with an English word after it (`setUserSetting`).
 */
const VERBS = new Set(
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
const ENGLISH_AFTER_SET = /^set(?:User|Global|Setting|Status|Job|Up|Default|Value|Cache|Price|State)/;

function englishName(/** @type {string} */ name) {
  const erstes = (/^[a-z]+/.exec(name) || [''])[0];
  if (erstes === 'set') return ENGLISH_AFTER_SET.test(name);
  return VERBS.has(erstes);
}

module.exports = { englishName };
