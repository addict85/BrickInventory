package ch.brickinventoryapp.app.nav

import ch.brickinventoryapp.app.csv.CsvImportViewModel
import ch.brickinventoryapp.dataapi.language.AppLanguage
import ch.brickinventoryapp.state.ui.AppViewModel
import ch.brickinventoryapp.state.ui.viewmodel.AppearanceViewModel
import ch.brickinventoryapp.state.ui.viewmodel.TrustViewModel

/**
 * The ViewModels that live as long as the activity — only what lies above every
 * destination: the session (MainActivity reads from it itself), the CSV import,
 * the design and the certificate question. Everything else hangs on its destination.
 */
class ActivityState(
    val app: AppViewModel,
    val csvImport: CsvImportViewModel,
    val appearance: AppearanceViewModel,
    val trust: TrustViewModel,
    /** Snackbar sentences outside the composition, in the app language. */
    val appLanguage: AppLanguage,
)
