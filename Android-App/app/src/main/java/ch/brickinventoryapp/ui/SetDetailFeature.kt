package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.*
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext


/**
 * Set-Detail: Stammdaten, Marktpreis und Preis-Historie (eigener SetDetailUiState-Flow).
 *
 * Feature-Modul des MainViewModel: Die Funktionen sind Extension-
 * Functions auf dem VM — die Körper sind 1:1 aus MainViewModel.kt
 * verschoben und greifen über internal-Sichtbarkeit auf die geteilten
 * Flows (_state, _snackbar, …) zu. Aufrufer (Screens/Navigation)
 * bleiben unverändert: vm.funktion() löst die Extension auf.
 */

internal fun MainViewModel.loadSetDetail(setNumber: String) {
    viewModelScope.launch {
        _setDetailState.update { it.copy(setDetailLoading = true) }
        when (val r = repo.sets.getSetDetail(setNumber)) {
            is Result.Success ->
                _setDetailState.update { it.copy(setDetail = r.data.set, setDetailLoading = false) }
            is Result.Error -> _setDetailState.update { it.copy(setDetailLoading = false) }
        }
    }
}

internal fun MainViewModel.loadSetPrice(setNumber: String) {
    viewModelScope.launch {
        _setDetailState.update { it.copy(setPriceLoading = true) }
        when (val r = repo.finanzen.getSetPrice(setNumber)) {
            is Result.Success ->
                _setDetailState.update { it.copy(setPrice = r.data, setPriceLoading = false) }
            is Result.Error -> _setDetailState.update { it.copy(setPriceLoading = false) }
        }
    }
}

internal fun MainViewModel.loadSetPriceHistory(setNumber: String) {
    viewModelScope.launch {
        _setDetailState.update { it.copy(priceHistoryLoading = true) }
        when (val r = repo.finanzen.getSetPriceHistory(setNumber)) {
            is Result.Success ->
                _setDetailState.update { it.copy(
                    priceHistory = r.data,
                    priceHistoryLoading = false
                )}
            is Result.Error -> _setDetailState.update { it.copy(priceHistoryLoading = false) }
        }
    }
}

internal fun MainViewModel.loadAcquisitions(setNumber: String) {
    viewModelScope.launch {
        _setDetailState.update { it.copy(acquisitionsLoading = true) }
        when (val r = repo.haushalt.getAcquisitions(setNumber)) {
            is Result.Success -> _setDetailState.update {
                it.copy(acquisitions = r.data.acquisitions,
                        acquisitionTotals = r.data.totals,
                        acquisitionsLoading = false)
            }
            is Result.Error -> _setDetailState.update { it.copy(acquisitionsLoading = false) }
        }
    }
}

/**
 * Schreibt das vom Server gelieferte Zustands-Aggregat in die Galerie-Liste.
 *
 * Ohne diesen Schritt blieb die Kachel nach einer Zustandsänderung im
 * Kaufpreis-Dialog auf dem alten Label stehen: loadAcquisitions() und
 * loadSetDetail() aktualisieren nur _setDetailState, die Liste im Galerie-Fluss
 * blieb unberührt bis zum nächsten vollständigen Neuladen.
 *
 * Bewusst der Serverwert und keine lokale Neuberechnung — die Regel
 * („eine U-Erfassung macht das Set gebraucht") gehört an genau eine Stelle.
 */
internal fun MainViewModel.applySetAggregate(agg: SetAggregate?) {
    if (agg == null || agg.setNumber.isBlank()) return
    // Die Liste liegt seit der Aufteilung im Galerie-Fluss, nicht mehr in
    // AppUiState — der Kommentar oben nennt sie noch `_state.sets`.
    _galleryState.update { st ->
        st.copy(sets = st.sets.map { s ->
            if (s.setNumber != agg.setNumber) s
            else s.copy(
                condition        = agg.condition ?: s.condition,
                // Ohne diese Zeile behielte die Kachel nach einer
                // Zustandsänderung die alten Plaketten, bis die Liste neu
                // geladen wird — derselbe Fehler, für den das Aggregat
                // ursprünglich eingeführt wurde, nur eine Ebene tiefer.
                conditions       = agg.conditions.ifEmpty { s.conditions },
                usedCount        = agg.usedCount ?: s.usedCount,
                maxPurchasePrice = agg.maxPurchasePrice ?: s.maxPurchasePrice,
                avgPurchasePrice = agg.avgPurchasePrice ?: s.avgPurchasePrice
            )
        })
    }
}

internal fun MainViewModel.updateAcquisition(setNumber: String, acqId: Int, purchasePrice: Double? = null, condition: String? = null, quantity: Int? = null, date: String? = null) {
    viewModelScope.launch {
        when (val r = repo.haushalt.updateAcquisition(setNumber, acqId, purchasePrice, condition, quantity, date)) {
            is Result.Success -> {
                if (r.data.success) {
                    applySetAggregate(r.data.set)
                    loadAcquisitions(setNumber)
                    // IMMER neu laden, auch bei einer reinen Preisänderung.
                    //
                    // VORHER stand hier
                    //   if (condition != null || quantity != null || date != null)
                    // — bei einer Preisänderung war keine der drei Bedingungen
                    // erfüllt, also blieb die Detailansicht auf dem alten Stand.
                    //
                    // Der Server SPEICHERT den Preis korrekt: Betrifft die
                    // Änderung die neueste Erfassung, spiegelt er sie zusätzlich
                    // nach sets.purchase_price (routes/api_v1/acquisitions.ts,
                    // parentPriceSql). Genau dieser Wert steht im Kopf der
                    // Detailansicht — und er wurde nie nachgeladen. Für den
                    // Nutzer sah das aus, als sei nichts gespeichert worden.
                    //
                    // Ein GET auf die Set-Daten kostet nichts. Eine Bedingung,
                    // die raten muss, ob sich am Set etwas geändert hat, ist hier
                    // die falsche Konstruktion — dieselbe Ursache wie zuletzt bei
                    // updateQuantity() und in der Webapp bei manQtySave().
                    loadSetDetail(setNumber)
                    // Kennzahlen und Portfolio-Wert hängen an Preis und Menge.
                    loadStats()
                    loadValuation()
                }
            }
            is Result.Error -> {
                _snackbar.value = meldung(r)
                if (date != null) loadAcquisitions(setNumber) // abgelehnte Datumsänderung zurücksetzen
            }
        }
    }
}

internal fun MainViewModel.deleteAcquisition(setNumber: String, acqId: Int) {
    viewModelScope.launch {
        when (val r = repo.haushalt.deleteAcquisition(setNumber, acqId)) {
            is Result.Success -> {
                if (r.data.success) {
                    applySetAggregate(r.data.set)
                    loadAcquisitions(setNumber)
                    loadSetDetail(setNumber)
                    // Kennzahlen und Portfolio-Wert hängen an Preis und Menge.
                    loadStats()
                    loadValuation()
                }
            }
            is Result.Error -> _snackbar.value = text(R.string.vm_error, "Delete failed")
        }
    }
}

// ── Anleitungen hinzufuegen und entfernen ────────────────────────────────
//
// Die App konnte sie bisher nur ANSEHEN. Beide Routen gab es laengst; sie lagen
// hinter dem sitzungsgebundenen Waechter (Nachtrag 127).

/**
 * Wie gross eine Anleitung sein darf.
 *
 * Derselbe Wert wie das `limits.fileSize` von uploadInstr in routes/sets.ts.
 * Er steht hier aus demselben Grund ein zweites Mal wie CSV_MAX_BYTES: Die App
 * muss die Grenze kennen, BEVOR sie eine 80-MB-Anleitung durch ein
 * Mobilfunknetz schickt.
 */
internal const val ANLEITUNG_MAX_BYTES = 50L * 1024 * 1024

/**
 * Welche Typen der Server annimmt.
 *
 * Die Liste steht in routes/sets.ts als INSTR_EXT_BY_MIME und ist dort eine
 * feste Allowlist mit Begruendung: Aus dem gemeldeten Typ leitet der Server die
 * DATEIENDUNG ab, und eine falsche Endung machte die Datei einmal zu
 * ausfuehrbarem HTML vom eigenen Origin. Die App filtert damit schon die
 * Auswahl, statt den Nutzer erst nach dem Hochladen abzuweisen.
 */
internal val ANLEITUNG_TYPEN = arrayOf("application/pdf", "image/jpeg", "image/png")

internal fun MainViewModel.ladeAnleitungHoch(setNumber: String, uri: android.net.Uri) {
    viewModelScope.launch {
        val gelesen = withContext(kotlinx.coroutines.Dispatchers.IO) {
            runCatching {
                val name = anleitungName(uri)
                val typ = ctx.contentResolver.getType(uri)
                val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                if (bytes == null || typ == null) null else Triple(name, typ, bytes)
            }.getOrNull()
        }
        if (gelesen == null) {
            _snackbar.value = text(R.string.csv_upload_unreadable); return@launch
        }
        val (name, typ, bytes) = gelesen
        if (typ !in ANLEITUNG_TYPEN) {
            _snackbar.value = text(R.string.instr_upload_wrong_type); return@launch
        }
        if (bytes.size > ANLEITUNG_MAX_BYTES) {
            _snackbar.value = text(R.string.csv_upload_too_big, ANLEITUNG_MAX_BYTES / 1024 / 1024)
            return@launch
        }
        when (val r = repo.sets.uploadAnleitung(setNumber, name, typ, bytes, name)) {
            is Result.Success ->
                if (r.data.success) {
                    _snackbar.value = text(R.string.instr_upload_done)
                    // Neu laden statt die Liste hier zu ergaenzen: Der Server
                    // vergibt Kennung und Pfad, und die Anzeige haengt an
                    // beidem.
                    loadSetDetail(setNumber)
                } else _snackbar.value = r.data.error ?: text(R.string.err_generic)
            is Result.Error -> _snackbar.value = meldung(r)
        }
    }
}

internal fun MainViewModel.loescheAnleitung(setNumber: String, instrId: Int) {
    viewModelScope.launch {
        when (val r = repo.sets.deleteAnleitung(setNumber, instrId)) {
            is Result.Success ->
                if (r.data.success) loadSetDetail(setNumber)
                else _snackbar.value = r.data.error ?: text(R.string.err_generic)
            is Result.Error -> _snackbar.value = meldung(r)
        }
    }
}

/** Der Anzeigename einer gewaehlten Datei — siehe dateiname() in SettingsFeature. */
private fun MainViewModel.anleitungName(uri: android.net.Uri): String =
    runCatching {
        ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
            val i = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            if (i >= 0 && c.moveToFirst()) androidx.core.database.getStringOrNull(c, i) else null
        }
    }.getOrNull() ?: "anleitung"
