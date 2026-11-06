package ch.brickinventoryapp.nav

import ch.brickinventoryapp.ui.AppViewModel
import ch.brickinventoryapp.ui.viewmodel.AnmeldungViewModel
import ch.brickinventoryapp.ui.viewmodel.CsvImportViewModel
import ch.brickinventoryapp.ui.viewmodel.DarstellungViewModel
import ch.brickinventoryapp.ui.viewmodel.ErfassungViewModel
import ch.brickinventoryapp.ui.viewmodel.GutscheinViewModel
import ch.brickinventoryapp.ui.viewmodel.UpdateViewModel
import ch.brickinventoryapp.ui.viewmodel.VertrauenViewModel

/**
 * Die ViewModels, die so lange leben wie die Activity. MainActivity holt sie
 * einmal und reicht sie über die [ZielUmgebung] weiter; so sucht kein Ziel
 * selbst im ViewModelStore der Activity, und man sieht, wer welches braucht.
 */
class AktivitaetsZustand(
    val app: AppViewModel,
    val erfassung: ErfassungViewModel,
    val update: UpdateViewModel,
    val csvImport: CsvImportViewModel,
    val anmeldung: AnmeldungViewModel,
    val gutschein: GutscheinViewModel,
    val darstellung: DarstellungViewModel,
    val vertrauen: VertrauenViewModel,
)
