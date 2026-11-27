import { z } from 'zod';
import { AccountName, type Route, legacyConfirmation, WITHOUT_BODY, IDENTIFIER, TEXT_OR_EMPTY } from './base';
import { DEGRADED, GenericResponse } from './shared';

export const HouseholdJoined = GenericResponse.extend({ linked_to: AccountName });

export const HouseholdUnlinked = GenericResponse.extend({ removed: z.number().int() });

export const SeparatedAccount = z.looseObject({
  id: z.number().int(),
  username: z.string(),
  via: z.string().nullable(),
});

export const HouseholdInviteResponse = z.looseObject({
  success: z.boolean(),
  code: z.string().nullable(),
  expires_in: z.number().int().nullable(),
});

export const HouseholdInviteCheckResponse = z.looseObject({
  success: z.boolean(),
  inviter: AccountName,
});

export const HouseholdMember = z.looseObject({
  depth: z.number().int(),
  id: z.number().int(),
  username: z.string(),
  is_self: z.boolean(),
});

export const HouseholdMembersResponse = z.looseObject({
  success: z.boolean(),
  members: z.array(HouseholdMember),
});

export const HouseholdStatusResponse = z.looseObject({
  view: z.array(HouseholdMember),
  success: z.boolean(),
  is_main: z.boolean(),
  is_sub: z.boolean(),
  currency: z.string(),
  linked_to: AccountName.nullable(),
  parents: z.array(AccountName),
  sub_accounts: z.array(HouseholdMember),
  open_invites: z.number().int(),
  former_links: z.array(SeparatedAccount),
  degraded: DEGRADED,
});

export const routes = {
  'GET /api/v2/settings/household': { small: true, response: HouseholdStatusResponse },
  'GET /api/v2/sets/household-members': { small: true, response: HouseholdMembersResponse },
  'POST /api/v2/settings/household/invite': { input: WITHOUT_BODY, response: HouseholdInviteResponse, secret: true },
  'POST /api/v2/settings/household/redeem/check': {
    response: HouseholdInviteCheckResponse,
    input: z.strictObject({ code: TEXT_OR_EMPTY(64) }),
  },
  'POST /api/v2/settings/household/redeem': {
    response: HouseholdJoined,
    ...legacyConfirmation({ code: TEXT_OR_EMPTY(64) }, 'password', 'factor_code'),
  },
  'POST /api/v2/settings/household/unlink': {
    input: z.strictObject({
      sub_user_id: IDENTIFIER.nullable().optional(),
      main_user_id: IDENTIFIER.nullable().optional(),
    }),
    response: HouseholdUnlinked,
  },
  'POST /api/v2/settings/household/former/dismiss': {
    input: z.strictObject({ sub_user_id: IDENTIFIER }),
    response: HouseholdUnlinked,
  },
} satisfies Record<string, Route>;
