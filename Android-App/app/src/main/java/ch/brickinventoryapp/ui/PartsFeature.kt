package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.*
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.launch


/**
 * Teile- und Minifig-Inventar: Laden, manuelle Erfassung, Inline-Edit, Löschen.
 *
 * Feature-Modul des MainViewModel: Die Funktionen sind Extension-
 * Functions auf dem VM — die Körper sind 1:1 aus MainViewModel.kt
 * verschoben und greifen über internal-Sichtbarkeit auf die geteilten
 * Flows (_state, _snackbar, …) zu. Aufrufer (Screens/Navigation)
 * bleiben unverändert: vm.funktion() löst die Extension auf.
 */

/**
 * Teile- und Figurenliste: Zustand und Regeln stehen in [Teile]. Diese
 * Einzeiler halten die Aufrufe der Bildschirme unverändert.
 */
internal fun MainViewModel.loadParts(page: Int = 1, debounce: Boolean = false) =
    teile.laden(seite = page, entprellt = debounce)

internal fun MainViewModel.setPartsQuery(q: String) = teile.setzeSuche(q)
internal fun MainViewModel.setPartsSpare(wert: String) = teile.setzeErsatzteile(wert)
internal fun MainViewModel.setPartsView(wert: String) = teile.setzeAnsicht(wert)
internal fun MainViewModel.setMinifigsView(wert: String) = teile.setzeFigurAnsicht(wert)
internal fun MainViewModel.setPartsColorFilter(wert: String) = teile.setzeFarbe(wert)
internal fun MainViewModel.setPartsCategoryFilter(wert: String) = teile.setzeKategorie(wert)
internal fun MainViewModel.loadPartsFilters() = teile.ladeFilter()
internal fun MainViewModel.loadPartsColors() = teile.ladeFarben()

/**
 * Teil erfassen.
 *
 * ── Ohne Ladeanzeige, und das ist eine Korrektur ────────────────────────────
 * Hier standen vier `_state.copy(isLoading = …)` (in addMinifig noch einmal
 * vier). Sie hatten in dieser Domäne KEINE Wirkung: Kein Teile-Bildschirm liest
 * das Feld — die Teileliste hat `partsLoading`, die Minifiguren
 * `minifigsLoading`. Gelesen wurde es von der Galerie, der Finanzübersicht und
 * dem Anmeldeformular.
 *
 * Die Wirkung lag also ausschliesslich woanders: Wer ein Teil erfasste, liess
 * die Galerie beschäftigt aussehen und blockierte über den Wächter in
 * loadMoreSets() ihr Nachladen. Siehe AppUiState.loginLaeuft.
 */
/**
 * Die Erfolgsmeldung nach dem Erfassen — samt Herkunft des Kaufpreises.
 *
 * ── Warum es das gibt (Nachtrag 167) ────────────────────────────────────────
 * Marcos zwei Befunde waren zwei Seiten derselben Tatsache: BrickLink fuehrt
 * zu vielen Teilen und Figuren nur EINEN Zustand.
 *
 *   „Der Zustand hat keinen Einfluss auf den Preis"  → der Rueckfall war unsichtbar
 *   „Teilweise wird der Kaufpreis nicht geladen"     → ohne Rueckfall blieb es leer
 *
 * Seine Entscheidung: uebernehmen und kennzeichnen. Der Server sagt in
 * `price_from_condition`, aus welchem Zustand der Wert stammt.
 *
 * EIN Bauteil fuer Teile UND Figuren: Die beiden Erfolgsbloecke waren schon
 * vorher zeichengleich bis auf die Nummer, und eine Regel in zwei Kopien wird
 * in diesem Baum verlaesslich nur in einer nachgezogen. Gegenstueck in der
 * Webapp: preisHerkunftHinweis() in public/js/06-minifigs.js.
 */
internal fun MainViewModel.erfassungsMeldung(
    angelegt: Boolean, nummer: String?, preisAusZustand: String?,
): String {
    val kopf = text(if (angelegt) R.string.vm_added else R.string.vm_updated, nummer)
    val hinweis = when (preisAusZustand) {
        "N" -> text(R.string.price_from_other_condition_new)
        "U" -> text(R.string.price_from_other_condition_used)
        else -> null
    }
    return if (hinweis != null) "$kopf — $hinweis" else kopf
}

internal fun MainViewModel.addPart(partNumber: String, colorId: Int = 0, colorName: String? = null, colorHex: String? = null,
            quantity: Int = 1, unitPrice: Double? = null,
            condition: String? = null, ownerUserId: Int? = null,
            storage: String? = null) {
    viewModelScope.launch {
        when (val r = repo.teile.addPart(partNumber.trim(), colorId, colorName, colorHex, quantity,
                                         unitPrice, condition, ownerUserId,
                                         storage?.trim()?.takeIf { it.isNotEmpty() })) {
            is Result.Success -> {
                if (r.data.success) {
                    _snackbar.value = erfassungsMeldung(
                        r.data.action == "added", r.data.partNumber, r.data.priceFromCondition)
                    // Liste, Bewertung UND Kennzahlen — siehe reloadItemList().
                    reloadItemList("part")
                } else {
                    _snackbar.value = r.data.error ?: text(R.string.err_unknown)
                }
            }
            is Result.Error -> {
                _snackbar.value = meldungFuerSnackbar(r)
            }
        }
    }
}

internal fun MainViewModel.addMinifig(figNumber: String, blFigNumber: String? = null, quantity: Int = 1,
               unitPrice: Double? = null, condition: String? = null, ownerUserId: Int? = null,
               storage: String? = null) {
    viewModelScope.launch {
        when (val r = repo.teile.addMinifig(figNumber.trim(), blFigNumber, quantity, unitPrice,
                                            condition, ownerUserId,
                                            storage?.trim()?.takeIf { it.isNotEmpty() })) {
            is Result.Success -> {
                if (r.data.success) {
                    _snackbar.value = erfassungsMeldung(
                        r.data.action == "added", r.data.figNumber, r.data.priceFromCondition)
                    // Liste, Bewertung UND Kennzahlen — siehe reloadItemList().
                    reloadItemList("fig")
                } else {
                    _snackbar.value = r.data.error ?: text(R.string.err_unknown)
                }
            }
            is Result.Error -> {
                _snackbar.value = meldungFuerSnackbar(r)
            }
        }
    }
}

/** @param owner Besitzer der Karte — siehe [deletePart]. */
internal fun MainViewModel.updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?, condition: String? = null, owner: Int? = null) {
    viewModelScope.launch {
        when (val r = repo.teile.updatePart(partNumber, colorId, quantity, unitPrice, condition, owner)) {
            is Result.Success -> {
                if (r.data.success) {
                    _snackbar.value = text(R.string.vm_saved)
                    // reloadItemList statt nur loadValuation: Die Kachel in der
                    // Übersicht zeigt Menge und Preis und blieb sonst auf dem
                    // alten Stand, bis der Reiter erneut geöffnet wurde.
                    reloadItemList("part")
                    // If a detail dialog is open for this item, reload its acquisitions
                    val det = _manDetailState.value
                    if (det.itemType == "part" && det.itemId == partNumber && det.colorId == colorId) {
                        loadManualAcquisitions("part", partNumber, colorId)
                    }
                } else _snackbar.value = r.data.error ?: text(R.string.err_unknown)
            }
            is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)
        }
    }
}

/**
 * Die Farbe eines manuell erfassten Teils nachtraeglich aendern.
 *
 * Marcos Bitte vom 19.10., nach dem Import mehrerer Wanted-Listen: „Weiter
 * moechte ich die Farbe nachtraeglich anpassen koennen fuer den Fall dass
 * diese nicht korrekt geladen wurde."
 *
 * Was in der Datenbank passiert — Umziehen oder ZUSAMMENLEGEN, und was mit den
 * Erfassungen geschieht — steht an einer Stelle: Web-App/utils/
 * teilFarbeAendern.ts. Bei Marco ist das Zusammenlegen der Normalfall, denn
 * dasselbe Teil stand daneben schon in der richtigen Farbe.
 *
 * @param colorId   die ALTE Farbe; sie sagt, welche Zeile gemeint ist.
 * @param neueFarbe die NEUE Farbe.
 * @param owner     Besitzer der Karte — siehe [deletePart].
 * @param onFertig  wird NUR bei Erfolg gerufen, mit der neuen Farbe. Der
 *   Detailbildschirm haengt an (Nummer, Farbe); nach der Aenderung zeigt er
 *   sonst auf eine Zeile, die es nicht mehr gibt, und bleibt leer.
 */
internal fun MainViewModel.setzeTeilFarbe(
    partNumber: String, colorId: Int, neueFarbe: Int,
    farbName: String? = null, farbHex: String? = null,
    owner: Int? = null, onFertig: (Int) -> Unit = {},
) {
    if (neueFarbe == colorId) return
    viewModelScope.launch {
        when (val r = repo.teile.setPartColor(partNumber, colorId, neueFarbe, farbName, farbHex, owner)) {
            is Result.Success -> {
                if (r.data.success) {
                    _snackbar.value = text(R.string.vm_saved)
                    reloadItemList("part")
                    onFertig(neueFarbe)
                } else _snackbar.value = r.data.error ?: text(R.string.err_unknown)
            }
            is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)
        }
    }
}

/**
 * Manuelles Teil loeschen.
 *
 * @param owner Besitzer der KARTE. Im Haushalt zeigt der manuelle Bereich die
 *   Eintraege aller Konten; ohne diese Angabe loescht der Server die Zeile des
 *   Aufrufers — geklickt waere die fremde Karte, weg die eigene.
 */
internal fun MainViewModel.deletePart(partNumber: String, colorId: Int, owner: Int? = null) {
    viewModelScope.launch {
        when (val r = repo.teile.deletePart(partNumber, colorId, owner)) {
            is Result.Success -> {
                if (r.data.success) { _snackbar.value = text(R.string.vm_part_deleted); reloadItemList("part") }
                else _snackbar.value = r.data.error ?: text(R.string.err_unknown)
            }
            is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)
        }
    }
}

/** @param owner Besitzer der Karte — siehe [deletePart]. */
internal fun MainViewModel.updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String? = null, condition: String? = null, owner: Int? = null) {
    viewModelScope.launch {
        when (val r = repo.teile.updateMinifig(figNumber, quantity, unitPrice, blFigNumber, condition, owner)) {
            is Result.Success -> {
                if (r.data.success) {
                    _snackbar.value = text(R.string.vm_saved)
                    // reloadItemList statt nur loadValuation: Die Kachel in der
                    // Übersicht zeigt Menge und Preis und blieb sonst auf dem
                    // alten Stand, bis der Reiter erneut geöffnet wurde.
                    reloadItemList("fig")
                    // Reload acquisitions if detail dialog open for this fig
                    val det = _manDetailState.value
                    if (det.itemType == "fig" && det.itemId == figNumber) {
                        loadManualAcquisitions("fig", figNumber)
                    }
                } else _snackbar.value = r.data.error ?: text(R.string.err_unknown)
            }
            is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)
        }
    }
}

/** @param owner Besitzer der Karte — siehe [deletePart]. */
internal fun MainViewModel.deleteMinifig(figNumber: String, owner: Int? = null) {
    viewModelScope.launch {
        when (val r = repo.teile.deleteMinifig(figNumber, owner)) {
            is Result.Success -> {
                if (r.data.success) { _snackbar.value = text(R.string.vm_minifig_deleted); reloadItemList("fig") }
                else _snackbar.value = r.data.error ?: text(R.string.err_unknown)
            }
            is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)
        }
    }
}

internal fun MainViewModel.loadMinifigs(debounce: Boolean = false) = teile.ladeFiguren(entprellt = debounce)
internal fun MainViewModel.setMinifigsQuery(q: String) = teile.setzeFigurSuche(q)
