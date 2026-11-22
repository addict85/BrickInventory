import { z } from 'zod';
import { AccountName, type Route, confirmed, WITHOUT_BODY, IDENTIFIER, TEXT_OR_EMPTY } from './base';
import { DEGRADED, GenericResponse } from './shared';

export const HaushaltBeigetreten = GenericResponse.extend({ linked_to: AccountName });

export const HaushaltGeloest = GenericResponse.extend({ removed: z.number().int() });

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
  tiefe: z.number().int(),
  id: z.number().int(),
  username: z.string(),
  is_self: z.boolean(),
});

export const HouseholdMembersResponse = z.looseObject({
  success: z.boolean(),
  members: z.array(HouseholdMember),
});

export const HouseholdStatusResponse = z.looseObject({
  blickfeld: z.array(HouseholdMember),
  success: z.boolean(),
  is_main: z.boolean(),
  is_sub: z.boolean(),
  currency: z.string(),
  linked_to: AccountName.nullable(),
  parents: z.array(AccountName),
  sub_accounts: z.array(HouseholdMember),
  open_invites: z.number().int(),
  former_links: z.array(SeparatedAccount),
  degradiert: DEGRADED,
});

export const routen = {
  'GET /api/v1/settings/household': { klein: true, antwort: HouseholdStatusResponse },
  'GET /api/v1/sets/household-members': { klein: true, antwort: HouseholdMembersResponse },
  'POST /api/v1/settings/household/invite': { eingabe: WITHOUT_BODY, antwort: HouseholdInviteResponse, geheim: true },
  'POST /api/v1/settings/household/redeem/pruefen': {
    antwort: HouseholdInviteCheckResponse,
    eingabe: z.strictObject({ code: TEXT_OR_EMPTY(64) }),
  },
  'POST /api/v1/settings/household/redeem': {
    antwort: HaushaltBeigetreten,
    ...confirmed({ code: TEXT_OR_EMPTY(64) }, 'password', 'faktor_code'),
  },
  'POST /api/v1/settings/household/unlink': {
    eingabe: z.strictObject({
      sub_user_id: IDENTIFIER.nullable().optional(),
      main_user_id: IDENTIFIER.nullable().optional(),
    }),
    antwort: HaushaltGeloest,
  },
  'POST /api/v1/settings/household/former/dismiss': {
    eingabe: z.strictObject({ sub_user_id: IDENTIFIER }),
    antwort: HaushaltGeloest,
  },
} satisfies Record<string, Route>;
