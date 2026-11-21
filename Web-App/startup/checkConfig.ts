/**
 * As the first import of server.ts: checks the whole configuration before any
 * other module reads a value while loading. An error ends the startup with
 * one message per variable instead of a stack trace from some module.
 */
import { checkKonfigOnStart, konfig } from '../src/infra/config';

checkKonfigOnStart();

export { konfig };
