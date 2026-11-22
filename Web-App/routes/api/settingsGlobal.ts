/** Global settings, import and export, setup, source and SMTP test; in settings.ts behind requireLogin. */
import multer from 'multer';
import { FORM_LIMITS } from '../../src/http/fileUpload';
import { accountGate, guardFor } from './middleware';
import { hasGlobalValues } from '../../src/management';
import { isAdmin, userName, confirmWithFactor } from '../../src/account/http/login';
import { released, asAdmin } from '../../src/account/http/stepGuard';
import { failDomain, DomainError } from '../../src/infra/errorTexts';
import { emailValid } from '../../src/infra/validate';
import { contractRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';

export function buildSettingsGlobalRouter(
  d: Pick<Services, 'settings' | 'mail' | 'account' | 'profile' | 'management'>,
) {
  const { requireApiAdmin: requireAdmin, requireToken } = guardFor(d.account);
  const router = contractRouter('/api/v2');

  router.endpoint('POST /api/v2/settings', requireToken, async (req, res) => {
    const uid = req.apiUser.user_id;
    // An administrator's global values go through the step guard like every administrator route.
    const verwalter = isAdmin(req) && hasGlobalValues(req.input);
    if (verwalter && !(await released(d.account, req, res, 'admin'))) return;
    const finished = await d.management.saveSettings(req.input, {
      uid,
      verwalter,
      name: userName(req) ?? '',
      confirm: passwort => confirmWithFactor(d.account, req, res, uid, passwort),
    });
    if (finished) return {};
  });

  // Via readSettings(), so the masking does not get bypassed by the packaging.
  router.endpoint('GET /api/v2/settings/raw', requireToken, async req => {
    return {
      settings: await d.settings.readSettings(req.apiUser.user_id, await asAdmin(d.account, req)),
    };
  });

  router.endpoint('GET /api/v2/settings/export', requireToken, async (req, res) => {
    const verwalter = await asAdmin(d.account, req);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="brickinventory-config-${new Date().toISOString().substring(0, 10)}.json"`,
    );
    res.json(await d.management.exportConfig(req.apiUser.user_id, verwalter, userName(req) ?? null));
  });

  router.endpoint('GET /api/v2/settings/export/data', requireToken, async (req, res) => {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="brickinventory-export-${new Date().toISOString().substring(0, 10)}.zip"`,
    );
    await d.management.dataZip(req.apiUser.user_id, res, e => {
      console.error('[export-zip]', e.message);
      res.status(500).end();
    });
  });

  const importUpload = multer({
    storage: multer.memoryStorage(),
    limits: { ...FORM_LIMITS, fileSize: 1024 * 1024 },
  });
  router.endpoint(
    'POST /api/v2/settings/import',
    requireToken,
    accountGate('upload'),
    importUpload.single('file'),
    async (req, res) => {
      if (!req.file) failDomain('ungueltig', 'no_file');
      // As administrator the import writes global values and reschedules the jobs.
      const verwalter = isAdmin(req);
      if (verwalter && !(await released(d.account, req, res, 'admin'))) return;
      return { ...(await d.management.importConfig(req.apiUser.user_id, verwalter, req.file.buffer)) };
    },
  );

  router.endpoint('POST /api/v2/settings/smtp-test', requireAdmin, async (req, res) => {
    const uid = req.apiUser.user_id;
    // Otherwise the mail server would be a relay to any address for a captured administrator session.
    const zuOft = await d.account.accountThrottled('smtp-test', uid, 10, 60 * 60 * 1000);
    if (zuOft) failDomain('zu_viele', 'too_many_requests', { minutes: zuOft.waitMin });

    const own = (await d.account.profile(uid))?.email || '';
    const to = (req.input.to || '').trim() || own;
    if (!emailValid(to)) {
      failDomain('ungueltig', 'no_target_email');
    }
    // Like changing the mail settings: to a foreign address only with password.
    if (
      to.toLowerCase() !== own.toLowerCase() &&
      !(await confirmWithFactor(d.account, req, res, uid, req.input.password))
    )
      return;

    res.json(await d.mail.sendSmtpTest(to));
  });

  // Open as long as the administrator has not completed it AND something
  // is missing — a configured installation never sees the wizard.
  router.endpoint('GET /api/v2/settings/setup', requireAdmin, async req => {
    const wert = async (k: string) => !!(await d.settings.globalValue(k));
    const passwort = await d.account.passwordSwitchDue(req.apiUser.user_id);
    const sources = {
      rebrickable: await wert('rebrickable_api_key'),
      brickset: await wert('brickset_api_key'),
      bricklink: (
        await Promise.all(
          ['bricklink_consumer_key', 'bricklink_consumer_secret', 'bricklink_token', 'bricklink_token_secret'].map(
            wert,
          ),
        )
      ).every(Boolean),
    };
    const done = await wert('einrichtung_erledigt');
    return { open: !done && (passwort || !sources.rebrickable), change_password: passwort, sources };
  });

  router.endpoint('POST /api/v2/settings/setup/complete', requireAdmin, async _req => {
    await d.settings.setGlobalValue('einrichtung_erledigt', '1');
    return {};
  });

  // Checks the STORED access with a small request.
  router.endpoint('POST /api/v2/settings/test-source', requireAdmin, async req => {
    const refusal = await d.management.checkSource(req.input.source);
    if (!refusal) return {};
    throw new DomainError(
      'ungueltig',
      refusal.code,
      { source: refusal.source, reason: refusal.reason },
      { details: refusal.reason },
    );
  });

  router.endpoint('POST /api/v2/settings/admin/theme', requireAdmin, async req => {
    const theme = req.input.theme;
    await d.profile.setGlobalTheme(theme);
    return { theme };
  });
  return router;
}
