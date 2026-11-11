package ch.brickinventoryapp.app.nav

import ch.brickinventoryapp.zustand.ui.AppViewModel
import ch.brickinventoryapp.app.csv.CsvImportViewModel
import ch.brickinventoryapp.zustand.ui.viewmodel.DarstellungViewModel
import ch.brickinventoryapp.konto.ui.viewmodel.UpdateViewModel
import ch.brickinventoryapp.zustand.ui.viewmodel.VertrauenViewModel

/**
 * Die ViewModels, die so lange leben wie die Activity — nur, was über jedem Ziel
 * liegt: die Sitzung (MainActivity liest selbst daraus), der Update-Hinweis, der
 * CSV-Import, das Design und die Zertifikatsfrage. Alles andere hängt an seinem Ziel.
 */
class AktivitaetsZustand(
    val app: AppViewModel,
    val update: UpdateViewModel,
    val csvImport: CsvImportViewModel,
    val darstellung: DarstellungViewModel,
    val vertrauen: VertrauenViewModel,
)
