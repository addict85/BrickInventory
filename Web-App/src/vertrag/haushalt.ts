import { z } from 'zod';
import { KontoName, type Route, bestaetigt, OHNE_RUMPF, KENNUNG } from './grund';
import { DEGRADIERT, GenericResponse } from './gemeinsam';

export const GetrenntesKonto = z.looseObject({
  id: z.number().int(),
  username: z.string(),
  via: z.string().nullable().optional(),
});

export const HouseholdInviteResponse = z.looseObject({
  success: z.boolean().optional(),
  code: z.string().nullable().optional(),
  expires_in: z.number().int().nullable().optional(),
  error: z.string().nullable().optional(),
});

export const HouseholdInviteCheckResponse = z.looseObject({
  success: z.boolean(),
  inviter: KontoName,
});

export const HouseholdMember = z.looseObject({
  tiefe: z.number().int().nullable().optional(),
  id: z.number().int(),
  username: z.string(),
  is_self: z.boolean(),
});

export const HouseholdMembersResponse = z.looseObject({
  success: z.boolean(),
  members: z.array(HouseholdMember),
});

export const HouseholdStatusResponse = z.looseObject({
  blickfeld: z.array(HouseholdMember).optional(),
  success: z.boolean(),
  is_main: z.boolean(),
  is_sub: z.boolean(),
  currency: z.string(),
  linked_to: KontoName.nullable().optional(),
  parents: z.array(KontoName),
  sub_accounts: z.array(HouseholdMember),
  open_invites: z.number().int(),
  former_links: z.array(GetrenntesKonto),
  error: z.string().nullable().optional(),
  degradiert: DEGRADIERT,
});

export const routen = {
  'GET /api/v1/settings/household': { klein: true, antwort: HouseholdStatusResponse },
  'GET /api/v1/sets/household-members': { klein: true, antwort: HouseholdMembersResponse },
  'POST /api/v1/settings/household/invite': { eingabe: OHNE_RUMPF, antwort: HouseholdInviteResponse, geheim: true },
  'POST /api/v1/settings/household/redeem/pruefen': {
    antwort: HouseholdInviteCheckResponse,
    eingabe: z.strictObject({ code: z.string().max(64).nullable().optional() }),
  },
  'POST /api/v1/settings/household/redeem': {
    antwort: GenericResponse,
    ...bestaetigt({ code: z.string().max(64).nullable().optional() }, 'password', 'faktor_code'),
  },
  'POST /api/v1/settings/household/unlink': {
    eingabe: z.strictObject({
      sub_user_id: KENNUNG.nullable().optional(),
      main_user_id: KENNUNG.nullable().optional(),
    }),
    antwort: GenericResponse,
  },
  'POST /api/v1/settings/household/former/dismiss': {
    eingabe: z.strictObject({ sub_user_id: KENNUNG }),
    antwort: GenericResponse,
  },
} satisfies Record<string, Route>;
