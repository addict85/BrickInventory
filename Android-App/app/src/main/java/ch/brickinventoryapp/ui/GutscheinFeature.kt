package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.GutscheinRequest
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Gutscheine — LEGO-Geschenkkarten im eigenen Profil.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 *   „Im Eigenen Profil sollen Lego-Gutscheine mit Gutscheinnummer und Pins und
 *    Betrag hinterlegt werden können. Für die Erfassung soll dies entweder
 *    manuell möglich sein für die 3 Werte oder das PDF des Gutscheins soll
 *    hochgeladen werden können und die App soll daraus die Werte extrahieren.
 *    […] Bitte die Login jeweils nur 1x im Backend bauen. Beide Apps sollen
 *    die gleichen Services des Backends verwenden."
 *
 * ── Was hier NICHT passiert ─────────────────────────────────────────────────
 *
 * Kein Auslesen des PDFs auf dem Geraet. Die Datei geht zum Server, der liest
 * sie (utils/gutscheinPdf.ts) und schickt die Werte zurueck. Das ist Marcos
 * Vorgabe und zugleich das einzig Sinnvolle: Eine zweite Leselogik in Kotlin
 * muesste mit der auf dem Server Schritt halten, und die Webapp braeuchte eine
 * dritte.
 *
 * Auch keine Pruefung der drei Werte hier. Welche Nummer gueltig ist, welcher
 * Betrag und welche Waehrung, entscheidet `pruefeWerte` in
 * routes/api_v1/vouchers.ts — EINMAL, fuer beide Apps. Die App zeigt, was
 * zurueckkommt.
 */

/** Die Liste laden. */
internal fun MainViewModel.ladeGutscheine() {
    viewModelScope.launch {
        _gutscheinState.update { it.copy(laedt = true) }
        when (val r = repo.gutscheine.liste()) {
            is Result.Success -> _gutscheinState.update {
                it.copy(gutscheine = r.data.vouchers, laedt = false)
            }
            is Result.Error -> {
                _gutscheinState.update { it.copy(laedt = false) }
                _snackbar.value = meldungFuerSnackbar(r)
            }
        }
    }
}

/** Ein Formularfeld setzen. */
internal fun MainViewModel.setzeGutscheinFeld(
    nummer: String? = null, pin: String? = null, betrag: String? = null,
    waehrung: String? = null,
) {
    _gutscheinState.update {
        it.copy(
            nummer = nummer ?: it.nummer,
            pin = pin ?: it.pin,
            betrag = betrag ?: it.betrag,
            waehrung = waehrung ?: it.waehrung,
        )
    }
}

/** Den PIN einer Zeile auf- oder zudecken. */
internal fun MainViewModel.schalteGutscheinPin(id: Int) {
    _gutscheinState.update {
        it.copy(pinSichtbar = if (id in it.pinSichtbar) it.pinSichtbar - id else it.pinSichtbar + id)
    }
}

/** Einen bestehenden Gutschein ins Formular holen. */
internal fun MainViewModel.bearbeiteGutschein(id: Int) {
    val g = _gutscheinState.value.gutscheine.find { it.id == id } ?: return
    _gutscheinState.update {
        it.copy(
            bearbeitet = g.id,
            nummer = g.number,
            pin = g.pin.orEmpty(),
            // Ganze Betraege ohne „.0": Der Gutschein lautet auf 400, nicht
            // auf 400.0 — und was im Feld steht, tippt der Nutzer gleich
            // weiter.
            betrag = if (g.amount % 1.0 == 0.0) g.amount.toLong().toString() else g.amount.toString(),
            waehrung = g.currency,
            // Die Datei bleibt, wie sie ist: Ein Gutschein bekommt sein PDF
            // beim Anlegen. Es nachtraeglich auszutauschen waere ein eigener
            // Vorgang und beantwortet keine Frage, die jemand hat.
            pdfName = null,
        )
    }
}

/** Formular leeren. */
internal fun MainViewModel.leereGutscheinFormular() {
    _gutscheinState.update {
        it.copy(bearbeitet = null, nummer = "", pin = "", betrag = "",
                waehrung = "CHF", pdfName = null)
    }
}

/**
 * Speichern — ein Weg fuer beide Faelle.
 *
 * Liegt eine Datei an, geht sie mit und der Server liest daraus, was die
 * Felder nicht hergeben. Liegt keine an, ist es eine gewoehnliche manuelle
 * Erfassung. Marcos „entweder … oder" ist damit keines in der Bedienung: Man
 * kann ein PDF schicken UND den Betrag selbst eintragen, wenn das PDF ihn
 * nicht nennt.
 */
internal fun MainViewModel.speichereGutschein(uri: android.net.Uri?) {
    viewModelScope.launch {
        val s = _gutscheinState.value
        _gutscheinState.update { it.copy(speichert = true) }
        try {
            // ── Aendern ──────────────────────────────────────────────────────
            val bearbeitet = s.bearbeitet
            if (bearbeitet != null) {
                val betrag = s.betrag.replace(',', '.').toDoubleOrNull()
                if (betrag == null) { _snackbar.value = text(R.string.vouchers_amount_invalid); return@launch }
                val r = repo.gutscheine.aendern(bearbeitet, GutscheinRequest(
                    number = s.nummer.trim(), pin = s.pin.trim().ifEmpty { null },
                    amount = betrag, currency = s.waehrung))
                behandleGutscheinAntwort(r)
                return@launch
            }

            // ── Aus dem PDF ──────────────────────────────────────────────────
            if (uri != null) {
                val gelesen = withContext(kotlinx.coroutines.Dispatchers.IO) {
                    runCatching {
                        val typ = ctx.contentResolver.getType(uri)
                        val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        if (bytes == null) null else Pair(typ ?: "application/pdf", bytes)
                    }.getOrNull()
                }
                if (gelesen == null) { _snackbar.value = text(R.string.csv_upload_unreadable); return@launch }
                val (typ, bytes) = gelesen
                // Der Server nimmt ausschliesslich PDF. Hier schon abzuweisen
                // spart den Upload und sagt es sofort — dieselbe Regel wie
                // beim Hochladen einer Anleitung.
                if (typ != "application/pdf") { _snackbar.value = text(R.string.vouchers_only_pdf); return@launch }

                val r = repo.gutscheine.ausPdf(
                    dateiname = s.pdfName ?: "gutschein.pdf", typ = typ, inhalt = bytes,
                    nummer = s.nummer, pin = s.pin, betrag = s.betrag.replace(',', '.'),
                    waehrung = s.waehrung,
                )
                if (r is Result.Success && !r.data.success) {
                    // Der Server hat gelesen, aber zu wenig gefunden (422). Was
                    // er LESEN KONNTE, wird eingetragen — der Nutzer ergaenzt
                    // den Rest und drueckt noch einmal, mit derselben Datei.
                    // Das ist der Unterschied zwischen „hat nicht geklappt" und
                    // „hier fehlt noch der Betrag".
                    val g = r.data.gelesen
                    _gutscheinState.update {
                        it.copy(
                            nummer = it.nummer.ifEmpty { g?.number.orEmpty() },
                            pin = it.pin.ifEmpty { g?.pin.orEmpty() },
                            betrag = it.betrag.ifEmpty {
                                g?.amount?.let { a -> if (a % 1.0 == 0.0) a.toLong().toString() else a.toString() }.orEmpty()
                            },
                            waehrung = g?.currency ?: it.waehrung,
                        )
                    }
                    _snackbar.value = text(R.string.vouchers_pdf_incomplete)
                    return@launch
                }
                behandleGutscheinAntwort(r)
                return@launch
            }

            // ── Manuell ──────────────────────────────────────────────────────
            val betrag = s.betrag.replace(',', '.').toDoubleOrNull()
            if (betrag == null) { _snackbar.value = text(R.string.vouchers_amount_invalid); return@launch }
            val r = repo.gutscheine.anlegen(GutscheinRequest(
                number = s.nummer.trim(), pin = s.pin.trim().ifEmpty { null },
                amount = betrag, currency = s.waehrung))
            behandleGutscheinAntwort(r)
        } finally {
            _gutscheinState.update { it.copy(speichert = false) }
        }
    }
}

/** Erfolg melden, Formular leeren, Liste neu holen — oder den Fehler zeigen. */
private suspend fun MainViewModel.behandleGutscheinAntwort(
    r: Result<ch.brickinventoryapp.data.model.GutscheinAntwort>,
) {
    when (r) {
        is Result.Success -> {
            if (!r.data.success) { _snackbar.value = r.data.error ?: text(R.string.vouchers_save_error); return }
            _snackbar.value = text(R.string.vouchers_saved)
            leereGutscheinFormular()
            ladeGutscheine()
        }
        is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)
    }
}

/**
 * Ein PDF mit mehreren Gutscheinen einlesen.
 *
 * Getrennt von speichereGutschein(): Das legt EINEN Gutschein an und nimmt
 * dabei die Formularfelder mit („was mitkommt, gewinnt"). Hier kommt nichts
 * aus dem Formular — der Stapel sagt selbst, was er traegt.
 */
internal fun MainViewModel.importiereGutscheinePdf(uri: android.net.Uri?) {
    if (uri == null) return
    viewModelScope.launch {
        _gutscheinState.update { it.copy(speichert = true) }
        try {
            val gelesen = withContext(kotlinx.coroutines.Dispatchers.IO) {
                runCatching {
                    val typ = ctx.contentResolver.getType(uri)
                    val bytes = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    if (bytes == null) null else Pair(typ ?: "application/pdf", bytes)
                }.getOrNull()
            }
            if (gelesen == null) { _snackbar.value = text(R.string.csv_upload_unreadable); return@launch }
            val (typ, bytes) = gelesen
            // Vor dem Hochladen abweisen: Dieselbe Regel wie beim Einzel-PDF —
            // ein Mobilfunknetz mit einer Datei zu belasten, die der Server
            // ohnehin ablehnt, ist der teuerste Weg zur selben Auskunft.
            if (typ != "application/pdf") { _snackbar.value = text(R.string.vouchers_only_pdf); return@launch }

            when (val r = repo.gutscheine.importierePdf(bytes)) {
                is Result.Success ->
                    if (r.data.success) {
                        // Rahmen aus Platzhaltern plus zwei Mengenformen, und
                        // zwar die BESTEHENDEN der CSV-Importe: Die Aussage ist
                        // dieselbe („n neu, m aufgefrischt"), also braucht sie
                        // keinen zweiten Satz Texte.
                        //
                        // Nicht „%1$d angelegt, %2$d aufgefrischt" in einem
                        // Stueck: Android-Lint meldet das als PluralsCandidate
                        // („Formatting %d followed by words"), und der Baum
                        // zaehlt die Lint-Befunde. GEMESSEN — genau daran war
                        // der dritte CI-Lauf von Stueck 3 rot.
                        _snackbar.value = text(R.string.vouchers_import_done,
                            menge(R.plurals.csv_upload_new, r.data.neuAngelegt, r.data.neuAngelegt),
                            menge(R.plurals.csv_upload_updated, r.data.updated, r.data.updated))
                        ladeGutscheine()
                    } else {
                        _snackbar.value = r.data.error ?: text(R.string.err_generic)
                    }
                // meldungFuerSnackbar und NICHT meldung: Bei 401 gibt diese
                // Fassung null zurueck, und der Kanal zeigt dann nichts — die
                // Sitzungsschicht hat die Abmeldung schon gemeldet, und ein
                // zweiter Satz daneben waere falsch.
                //
                // AbgewiesenTest faengt genau das („keine Snackbar bekommt den
                // Satz an der Regel vorbei"), und es hat mich gefangen: Ich
                // hatte meldung(r) von der CSV-Stelle uebernommen, die in einen
                // UI-ZUSTAND schreibt und nicht in die Snackbar. Dort ist es
                // richtig, hier nicht. Zeile 47 dieser Datei macht es vor.
                is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)
            }
        } finally {
            _gutscheinState.update { it.copy(speichert = false) }
        }
    }
}

/**
 * Das Guthaben einer Karte bei LEGO abfragen und speichern.
 *
 * ── Marcos Vorgaben ────────────────────────────────────────────────────────
 *
 *   „Kannst du dies bei den Gutscheinen einbauen, damit dies auf Knopfdruck
 *    abgefragt und gespeichert werden kann?"
 *
 *   „Der Zurueckgemeldete Betrag soll im Feld Betrag gespeichert werden."
 *
 * Gespeichert wird auf dem SERVER — er schreibt Betrag, Waehrung und den
 * Zeitpunkt und gibt die fertige Zeile zurueck. Hier wird deshalb nichts
 * gerechnet und nichts zusammengesetzt; `ladeGutscheine()` holt danach die
 * Liste, damit Betrag, Summe und Stand in einem Zug stimmen.
 *
 * ── Keine Wartelogik hier ──────────────────────────────────────────────────
 *
 * Der Server erlaubt hoechstens eine Abfrage je 30 Sekunden ueber ALLE
 * Benutzer und schickt bei einer Absage den fertigen Satz samt Restzeit mit.
 * Ihn hier in eine Wiederholung umzubauen hiesse, die Grenze zu umgehen, die
 * Marco gesetzt hat — die App zeigt die Auskunft und laesst den Menschen
 * entscheiden.
 */
internal fun MainViewModel.frageGuthabenAb(id: Int) {
    viewModelScope.launch {
        _gutscheinState.update { it.copy(guthabenLaeuft = id) }
        try {
            when (val r = repo.gutscheine.guthaben(id)) {
                is Result.Success -> {
                    val d = r.data
                    val v = d.voucher
                    if (!d.success || v == null) {
                        _snackbar.value = d.error ?: text(R.string.err_generic)
                        return@launch
                    }
                    // Der formatierte Text der Gegenseite, wenn er da ist: Er
                    // steht in der Schreibweise des Ausgabelandes und ist
                    // genau das, was auf der LEGO-Seite stuende.
                    val betrag = d.angezeigt ?: "%.2f %s".format(v.amount, v.currency)
                    var satz = text(R.string.vouchers_balance_done, v.number, betrag)
                    // Angehaengt und nicht als zweite Meldung: Der Snackbar
                    // zeigt eine zur Zeit, die zweite ueberschriebe die erste.
                    // Und verschwiegen werden darf es nicht — eine geaenderte
                    // Waehrung ist eine geaenderte Summe.
                    if (d.waehrungGeaendert) {
                        satz += " " + text(R.string.vouchers_balance_currency, v.currency)
                    }
                    _snackbar.value = satz
                    ladeGutscheine()
                }
                is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)
            }
        } finally {
            _gutscheinState.update { it.copy(guthabenLaeuft = null) }
        }
    }
}

internal fun MainViewModel.loescheGutschein(id: Int) {
    viewModelScope.launch {
        when (val r = repo.gutscheine.loeschen(id)) {
            is Result.Success -> { _snackbar.value = text(R.string.vouchers_deleted); ladeGutscheine() }
            is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)
        }
    }
}

/**
 * Rueckmeldung nach dem Kopieren.
 *
 * Das Kopieren selbst macht die Oberflaeche (LocalClipboardManager ist an die
 * Komposition gebunden, nicht an das ViewModel). Hier steht nur der Satz —
 * damit er ueber denselben Weg geht wie jede andere Meldung der App und nicht
 * als zweite Art von Rueckmeldung danebensteht.
 */
internal fun MainViewModel.meldeGutscheinKopiert(istNummer: Boolean) {
    _snackbar.value = text(
        if (istNummer) R.string.vouchers_copied_number else R.string.vouchers_copied_pin)
}

/** Das PDF dieses Gutscheins anzeigen — der Graph greift das Ziel ab. */
internal fun MainViewModel.oeffneGutscheinPdf(id: Int) {
    _gutscheinState.update { it.copy(pdfZiel = id) }
}

/** Erledigt — sonst springt die App bei der naechsten Rekomposition erneut. */
internal fun MainViewModel.gutscheinPdfQuittieren() {
    _gutscheinState.update { it.copy(pdfZiel = null) }
}

/**
 * Die Adresse des hinterlegten PDFs — fuer den vorhandenen PDF-Betrachter.
 *
 * Marcos Vorgabe: „Das PDF soll jeweils auch wieder heruntergeladen, resp. in
 * einem neuen Fenster angezeigt werden können." Auf Android ist das neue
 * Fenster der PdfViewerScreen, den es schon gibt — er rendert mit PdfRenderer
 * und bringt Drucken und Speichern mit.
 *
 * Hier wird deshalb NICHTS heruntergeladen: Der Betrachter bekommt die
 * Adresse und laedt sie mit dem angemeldeten Client der App (vm.apiHttpClient)
 * selbst. Ein eigener Download waere eine zweite Fassung desselben Weges — und
 * die Datei laege danach im Cache des Geraets, wo ein Gutschein nichts zu
 * suchen hat.
 */
internal fun gutscheinPdfAdresse(serverUrl: String, id: Int): String =
    serverUrl.trimEnd('/') + "/api/v1/vouchers/" + id + "/pdf"
