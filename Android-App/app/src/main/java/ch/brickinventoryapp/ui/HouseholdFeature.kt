package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.model.HouseholdMember
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Haushalt: Kontofilter je Ansicht, Mitgliederliste, Verknüpfen und
 * Verschieben.
 *
 * ── Was hier NICHT entschieden wird ─────────────────────────────────────────
 * Wer zum Haushalt gehört, wer schreiben darf und was ein Filterwert bedeutet
 * — all das beantwortet der Server (utils/household.ts). Die App reicht den
 * Wert als `accounts=` durch und zeigt, was zurückkommt. Eine zweite Fassung
 * dieser Regeln hier wäre genau die Doppelung, an der in diesem Projekt schon
 * mehrere Zahlen auseinandergelaufen sind.
 */

/** Filterwert einer Ansicht — für die Anfrage aufbereitet (null = alle). */
internal fun MainViewModel.scopeFor(view: ScopeFilter.View): String? =
    ScopeFilter.asQuery(_state.value.scopeModes[view.key])

/**
 * Filter setzen und NUR die betroffene Ansicht neu laden.
 *
 * Alle vier gleichzeitig neu zu laden würde drei Ansichten anfassen, die
 * niemand gerade ansieht — und dabei Preisabrufe auslösen.
 */
internal fun MainViewModel.setScope(view: ScopeFilter.View, value: String) {
    viewModelScope.launch {
        ScopeFilter.set(ctx, view, value)
        _state.update { it.copy(scopeModes = it.scopeModes + (view.key to value)) }
        when (view) {
            ScopeFilter.View.GALLERY  -> { loadSets(); loadStats() }
            // Die Reiter Teile und Minifiguren haben je ZWEI Listen: die aus
            // Sets und die manuell erfassten. Letztere kommen aus der
            // Bewertung — ohne sie bliebe der manuelle Bereich ungefiltert
            // stehen, genau der Fehler, der in der Webapp gemeldet wurde.
            ScopeFilter.View.PARTS    -> { loadParts(); loadPartsValuationOnly() }
            ScopeFilter.View.MINIFIGS -> { loadMinifigs(); loadFigsValuationOnly() }
            ScopeFilter.View.FINANCE  -> {
                loadValuation()
                loadPortfolioHistory(_financeState.value.historyPeriod)
            }
        }
    }
}

/** Gespeicherte Filterwerte beim Start einlesen. */
internal fun MainViewModel.loadScopeModes() {
    viewModelScope.launch {
        val modes = ScopeFilter.View.entries.associate { v ->
            v.key to (ScopeFilter.flow(ctx, v).let { f ->
                var value = ScopeFilter.ALL
                f.collect { value = it; return@collect }
                value
            })
        }
        _state.update { it.copy(scopeModes = modes) }
    }
}

/**
 * Mitglieder des Haushalts laden.
 *
 * Dieselbe Antwort entscheidet über drei Dinge: ob der Kontofilter überhaupt
 * erscheint, welche Einträge er hat und welche Konten beim Erfassen und
 * Verschieben zur Wahl stehen. Mehr als ein Eintrag heisst: Hauptkonto mit
 * Unterkonten.
 */
internal fun MainViewModel.loadHouseholdMembers() {
    viewModelScope.launch {
        when (val r = repo.haushalt.getHouseholdMembers()) {
            is Result.Success -> {
                val members = r.data.members
                _state.update { st ->
                    // Zeigt eine gespeicherte Wahl auf ein inzwischen
                    // entkoppeltes Konto, fällt sie auf „Alle" zurück — sonst
                    // bliebe die Liste unerklärlich gefiltert.
                    val opts = ScopeFilter.options(members, "", "").map { it.first }
                    st.copy(
                        householdMembers = members,
                        scopeModes = st.scopeModes.mapValues { (_, v) ->
                            if (opts.isEmpty() || opts.contains(v)) v else ScopeFilter.ALL
                        }
                    )
                }
            }
            is Result.Error -> { /* ohne Haushalt bleibt die Liste leer — kein Fehlerfall */ }
        }
    }
}

/** Zustand der Verknüpfung für die Einstellungen. */
internal fun MainViewModel.loadHouseholdStatus() {
    viewModelScope.launch {
        _householdState.update { it.copy(isLoading = true, message = null) }
        when (val r = repo.haushalt.getHousehold()) {
            is Result.Success -> _householdState.update {
                it.copy(isLoading = false, status = r.data, inviteCode = null)
            }
            is Result.Error -> _householdState.update { it.copy(isLoading = false, message = meldung(r)) }
        }
    }
}

internal fun MainViewModel.createHouseholdInvite() {
    viewModelScope.launch {
        _householdState.update { it.copy(isLoading = true, message = null) }
        when (val r = repo.haushalt.createHouseholdInvite()) {
            is Result.Success ->
                if (r.data.success) _householdState.update { it.copy(isLoading = false, inviteCode = r.data.code) }
                else _householdState.update { it.copy(isLoading = false, message = r.data.error) }
            is Result.Error -> _householdState.update { it.copy(isLoading = false, message = meldung(r)) }
        }
    }
}

internal fun MainViewModel.redeemHouseholdInvite(code: String) {
    viewModelScope.launch {
        _householdState.update { it.copy(isLoading = true, message = null) }
        when (val r = repo.haushalt.redeemHouseholdInvite(code.trim())) {
            is Result.Success -> {
                // Der Server lehnt ab, wenn die Währung abweicht, das Konto
                // schon verknüpft ist oder die Verknüpfung eine zweite Stufe
                // wäre. Seine Meldung ist genauer als alles, was die App
                // daraus ableiten könnte — deshalb wird sie durchgereicht.
                _householdState.update { it.copy(isLoading = false, message = r.data.error) }
                if (r.data.success) { loadHouseholdStatus(); loadHouseholdMembers() }
            }
            is Result.Error -> _householdState.update { it.copy(isLoading = false, message = meldung(r)) }
        }
    }
}

/** subUserId leer = die eigene Verknüpfung lösen (als Unterkonto). */
internal fun MainViewModel.unlinkHousehold(subUserId: Int? = null) {
    viewModelScope.launch {
        when (repo.haushalt.unlinkHousehold(subUserId)) {
            is Result.Success -> { loadHouseholdStatus(); loadHouseholdMembers(); loadSets() }
            is Result.Error -> {}
        }
    }
}

/**
 * Set — oder einzelne Kaufpreise davon — in ein anderes Konto verschieben.
 *
 * Danach wird neu geladen statt nachgezogen: Nach einem Wechsel stimmen Menge,
 * Summen und Besitzer-Plaketten an mehreren Stellen nicht mehr; vier davon
 * einzeln nachzuführen wäre die Art Handarbeit, die man beim fünften Ort
 * vergisst.
 */
/**
 * Eigentümer EINER Kaufpreis-Zeile wechseln — für alle drei Arten.
 *
 * Das ist der einzige Weg, Bestand zwischen Konten zu verschieben: Die
 * Detailansichten haben keinen Verschieben-Knopf. Ein Set mit drei Erfassungen
 * sind drei Käufe, die im Haushalt verschiedenen Kindern gehören können —
 * „das Set verschieben" verdeckt, was tatsächlich wandert. Wer alles
 * verschieben will, ändert jede Zeile und sieht dabei, wie viele es sind.
 *
 * Der Server erzwingt dieselbe Regel: move ohne acquisition_ids antwortet 400.
 */
/**
 * @param onDone (Fehlermeldung oder null, mitgewanderte Teile, mitgewanderte
 *        Minifiguren). Die beiden Zahlen kommen vom Server; der Aufrufer baut
 *        daraus die Erfolgsmeldung. Vorher stand dort ein fest verdrahtetes
 *        „0 Teile und 0 Minifiguren", egal was tatsächlich gewandert war.
 */
internal fun MainViewModel.changeAcquisitionOwner(
    type: String, id: String, colorId: Int, acqId: Int,
    toUserId: Int, onDone: (String?, Int, Int) -> Unit = { _, _, _ -> }
) {
    viewModelScope.launch {
        // Kein Absender im Request: Die Erfassungs-ID ist eindeutig, und wem
        // die Zeile gehört, ermittelt der Server aus der Zeile selbst
        // (acquisitionMoveSource). Die App schickte den Wert bisher korrekt
        // mit — der Server ignoriert ihn inzwischen, und ein Feld, das nichts
        // mehr bewirkt, gehört nicht in den Vertrag.
        // Hier geht kein Preis mit — fuerStueck() nur der Einheitlichkeit halber.
        val req = ch.brickinventoryapp.data.model.UpdateAcquisitionRequest.fuerStueck(
            ownerUserId = toUserId)
        val r = when (type) {
            "set"  -> repo.haushalt.updateAcquisition(id, acqId, ownerUserId = toUserId)
            "fig"  -> repo.haushalt.updateFigAcquisition(id, acqId, req)
            else   -> repo.haushalt.updatePartAcquisition(id, colorId, acqId, req)
        }
        when (r) {
            is Result.Success -> {
                if (r.data.success) {
                    // Menge, Summen und Besitzer-Plaketten stimmen danach an
                    // mehreren Stellen nicht mehr — neu laden statt vier Orte
                    // einzeln nachzuführen.
                    loadSets(); loadValuation()
                    onDone(null, r.data.parts ?: 0, r.data.minifigs ?: 0)
                } else onDone(r.data.error ?: "", 0, 0)
            }
            is Result.Error -> onDone(meldung(r), 0, 0)
        }
    }
}

internal fun MainViewModel.moveSet(
    setNumber: String, fromUserId: Int?, toUserId: Int, acquisitionIds: List<Int>? = null,
    onDone: (String?) -> Unit = {}
) {
    viewModelScope.launch {
        when (val r = repo.sets.moveSet(setNumber, fromUserId, toUserId, acquisitionIds)) {
            is Result.Success -> {
                if (r.data.success) { loadSets(); loadValuation(); onDone(null) }
                else onDone(r.data.error ?: "")
            }
            is Result.Error -> onDone(meldung(r))
        }
    }
}
