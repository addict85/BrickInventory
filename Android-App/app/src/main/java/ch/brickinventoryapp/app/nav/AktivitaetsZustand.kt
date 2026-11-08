package ch.brickinventoryapp.app.nav

import ch.brickinventoryapp.zustand.ui.AppViewModel
import ch.brickinventoryapp.anmeldung.ui.viewmodel.AnmeldungViewModel
import ch.brickinventoryapp.zustand.ui.viewmodel.CsvImportViewModel
import ch.brickinventoryapp.zustand.ui.viewmodel.DarstellungViewModel
import ch.brickinventoryapp.sammlung.ui.viewmodel.ErfassungViewModel
import ch.brickinventoryapp.finanzen.ui.viewmodel.GutscheinViewModel
import ch.brickinventoryapp.konto.ui.viewmodel.UpdateViewModel
import ch.brickinventoryapp.zustand.ui.viewmodel.VertrauenViewModel

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
