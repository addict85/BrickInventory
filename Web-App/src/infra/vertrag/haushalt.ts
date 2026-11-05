import { z } from 'zod';
import { KontoName, type Route, bestaetigt } from './grund';
import { GenericResponse } from './gemeinsam';

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
  id: z.number().int(),
  username: z.string(),
  is_self: z.boolean(),
});

export const HouseholdMembersResponse = z.looseObject({
  success: z.boolean(),
  members: z.array(HouseholdMember),
});

export const HouseholdStatusResponse = z.looseObject({
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
});

export const routen = {
  'GET /api/v1/settings/household': { antwort: HouseholdStatusResponse },
  'GET /api/v1/sets/household-members': { antwort: HouseholdMembersResponse },
  'POST /api/v1/settings/household/invite': { antwort: HouseholdInviteResponse, geheim: true },
  'POST /api/v1/settings/household/redeem/pruefen': { antwort: HouseholdInviteCheckResponse, eingabe: z.looseObject({ code: z.string().max(64).nullable().optional() }) },
  'POST /api/v1/settings/household/redeem': { antwort: GenericResponse, ...bestaetigt({ code: z.string().max(64).nullable().optional() }, 'password', 'faktor_code') },
  'POST /api/v1/settings/household/unlink': { antwort: GenericResponse },
  'POST /api/v1/settings/household/former/dismiss': { antwort: GenericResponse },
} satisfies Record<string, Route>;
