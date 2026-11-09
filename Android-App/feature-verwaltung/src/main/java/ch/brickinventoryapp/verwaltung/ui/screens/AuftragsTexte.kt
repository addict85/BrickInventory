package ch.brickinventoryapp.verwaltung.ui.screens

import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.model.ui.model.AuftragStatus

// Die Texte zu Aufträgen gehören zur Anzeige: Das UI-Modell in core-model kennt
// keine Android-Ressourcen.

/** Text eines Auftragszustands; ERLEDIGT und UNBEKANNT zeigen keinen. */
val AuftragStatus.statusText: Int?
    get() = when (this) {
        AuftragStatus.OFFEN -> R.string.hintergrund_offen
        AuftragStatus.LAEUFT -> R.string.hintergrund_laeuft
        AuftragStatus.FEHLER -> R.string.hintergrund_fehler
        AuftragStatus.ABGEBROCHEN -> R.string.hintergrund_abgebrochen
        AuftragStatus.ERLEDIGT, AuftragStatus.UNBEKANNT -> null
    }

/** Die Namen der Arten wie in der Webapp (monitor.art.*); unbekannte zeigt die Liste roh. */
internal fun auftragsArtText(art: String): Int? = when (art) {
    "nacharbeit" -> R.string.art_nacharbeit
    "bilder" -> R.string.art_bilder
    "pdf" -> R.string.art_pdf
    "csv_import" -> R.string.art_csv_import
    "wechselkurse" -> R.string.art_wechselkurse
    "anleitung" -> R.string.art_anleitung
    "brickset" -> R.string.art_brickset
    "bildbedarf" -> R.string.art_bildbedarf
    "bilder_neu_laden" -> R.string.art_bilder_neu_laden
    "nachlauf" -> R.string.art_nachlauf
    "csv_sync" -> R.string.art_csv_sync
    "preise" -> R.string.art_preise
    "bild_nachlauf" -> R.string.art_bild_nachlauf
    "aufraeumen" -> R.string.art_aufraeumen
    "aufraeumen_taeglich" -> R.string.art_aufraeumen_taeglich
    else -> null
}
