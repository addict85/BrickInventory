/**
 * As the first import of server.ts: checks the whole configuration before any
 * other module reads a value while loading. An error ends the startup with
 * one message per variable instead of a stack trace from some module.
 */
import { checkConfigOnStart, config } from '../src/infra/config';

checkConfigOnStart();

export { config };
