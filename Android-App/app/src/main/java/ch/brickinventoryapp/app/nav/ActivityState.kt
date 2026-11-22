package ch.brickinventoryapp.app.nav

import ch.brickinventoryapp.state.ui.AppViewModel
import ch.brickinventoryapp.app.csv.CsvImportViewModel
import ch.brickinventoryapp.state.ui.viewmodel.AppearanceViewModel
import ch.brickinventoryapp.account.ui.viewmodel.UpdateViewModel
import ch.brickinventoryapp.state.ui.viewmodel.TrustViewModel

/**
 * The ViewModels that live as long as the activity — only what lies above every
 * destination: the session (MainActivity reads from it itself), the update hint, the
 * CSV import, the design and the certificate question. Everything else hangs on its destination.
 */
class ActivityState(
    val app: AppViewModel,
    val update: UpdateViewModel,
    val csvImport: CsvImportViewModel,
    val appearance: AppearanceViewModel,
    val trust: TrustViewModel,
)
