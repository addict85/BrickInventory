// Entry point of the bundle and the explicit load order: core, building blocks, views (layers in
// scripts/build-frontend.js). Every file under js/ is listed here, because the bundle script checks completeness at the
// entry point. The import graph is cycle-free (test/frontend-architektur.test.js).

// Kern
import './styles.js';
import './escaping.js';
import './events.js';
import './targets.js';
import './state.js';
import './load-guard.js';
import '../i18n.js';

// Building blocks
import './dom.js';
import './format.js';
import './messages.js';
import './connection.js';
import './api.js';
import './images.js';
import './form.js';
import './account.js';
import './dialogs.js';
import './progress.js';
import './job-names.js';
import './monitor.js';
import './components.js';
import './confirm-prompt.js';
import './crosshair.js';
import './time-axis.js';
import './charts.js';

// Views
import './detail-fields.js';
import './account-locations.js';
import './sets-table.js';
import './metrics.js';
import './collection.js';
import './set-add.js';
import './set-csv-import.js';
import './parts.js';
import './part-add.js';
import './value-curve.js';
import './finances.js';
import './finance-metrics.js';
import './settings.js';
import './accesses.js';
import './household.js';
import './user-management.js';
import './alerts.js';
import './storage-locations.js';
import './minifigs.js';
import './admin.js';
import './set-detail.js';
import './error-capture.js';
import './init.js';
import './catalog.js';
import './mobile.js';
import './actions.js';
import './pdfviewer.js';
import './purchase-price-display.js';
import './entry-state.js';
import './purchase-dialogs.js';
import './manual-detail.js';
import './set-parts.js';
import './account-filter.js';
import './scrollbar.js';
import './wanted.js';
import './vouchers.js';
import './balance.js';
import './wanted-xml.js';
import './bricklink-xml.js';
import './trash.js';
import './deletion.js';
import './second-factor.js';
import './setup.js';
import './passkeys.js';
import './router.js';
import './navigation.js';
import './start-box.js';
import './mail-link.js';
import './session.js';
import './setup-status.js';

// Startup happens only after all modules have been evaluated.
import { startApp } from './session.js';
startApp();
