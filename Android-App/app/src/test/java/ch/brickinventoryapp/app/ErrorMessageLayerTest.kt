package ch.brickinventoryapp.app

import org.junit.Test
import ch.brickinventoryapp.testing.Quellen

/**
 * Fehlermeldungen entstehen an EINER Stelle, und die kann übersetzen.
 *
 * ── Woher dieser Test kommt (Nachtrag 116) ──────────────────────────────────
 *
 * `BrickRepository.safeCall()` formulierte seine Meldungen selbst:
 *
 * Von 36 Snackbar-Zuweisungen liefen damals 19 über `getString`; der Rest
 * reichte durch, was aus der Datenschicht kam. Es waren also zwei Sprachregime
 * nebeneinander, und welches griff, hing davon ab, wo der Fehler entstand.
 *
 * Jetzt meldet die Datenschicht nur noch die URSACHE als Art von `Ergebnis.Error`;
 * den Satz formuliert `AppTexte.meldung()`. Dieser Test hält beide Hälften fest.
 *
 * Gegenprobe: gegenproben/fehler-satz-in-datenschicht.patch — sicherAufrufen()
 * legt einen festen Satz in Ergebnis.Error.Server → rot „die Datenschicht baut
 * keine Meldung …“.
 */
class ErrorMessageLayerTest {

    private val datenschicht = listOf(
        // Alle Dateien der Datenschicht (Nachtrag 155) — vorher nur die eine.
        "data/repository/Ergebnis.kt",
        "data/repository/RepoBasis.kt",
        "data/repository/SetsRepositoryImpl.kt",
        "data/repository/TeileRepositoryImpl.kt",
        "data/repository/FinanzenRepositoryImpl.kt",
        "data/repository/HaushaltRepositoryImpl.kt",
        "data/repository/FigurenRepositoryImpl.kt",
        "data/repository/KontoRepositoryImpl.kt",
        "data/repository/VerwaltungRepositoryImpl.kt",
        "data/repository/KatalogRepositoryImpl.kt",
        "data/repository/GutscheineRepositoryImpl.kt",
        "data/CsvImportSseClient.kt",
    )

    @Test
    fun `die Datenschicht baut keine Meldung fuer den Nutzer`() {
        // Gesucht: ein fester Satz als Meldung — Server(status, "…"), Abgewiesen("…")
        // oder message = "…". Erlaubt ist nur der leere Text — dann entscheidet die
        // Anzeige — oder eine durchgereichte Servermeldung (eine Variable).
        val satz = Regex("""Ergebnis\.Error\.(?:Abgewiesen\(\s*|Server\((?:[^,()]|\([^()]*\))*,\s*)"([^"]+)"|\bmessage\s*=\s*"([^"]+)"""")
        val fehler = mutableListOf<String>()
        for (rel in datenschicht) {
            val s = Quellen.ohneKommentare(Quellen.lies(rel))
            satz.findAll(s).forEach { m ->
                val zeile = s.substring(0, m.range.first).count { it == '\n' } + 1
                fehler += "$rel:$zeile  ${m.value}"
            }
        }
        assert(fehler.isEmpty()) {
            "Die Datenschicht formuliert wieder selbst. Sie hat keinen Context und " +
                "kann nicht übersetzen — stattdessen eine Fehlerart melden und den " +
                "Satz in AppTexte.meldung() bilden:\n  " + fehler.joinToString("\n  ")
        }
    }

    @Test
    fun `die Zuordnung Ursache zu Text liegt ausserhalb von meldung`() {
        // Ob jede Fehlerart einen eigenen Satz hat, prüft seit Nachtrag 117
        // FehlerTexteTest — ausgeführt statt gelesen. Hier bleibt nur die
        // Aussage, die eine Textsuche wirklich treffen kann: dass die
        // Zuordnung eine eigene, Context-freie Funktion IST. Wandert sie
        // zurück in meldung(), ist sie wieder nur über Android prüfbar.
        val texte = Quellen.ohneKommentare(Quellen.lies("zustand/ui/FehlerTexte.kt"))
        assert(texte.contains("fun fehlerTextId(")) { "fehlerTextId() fehlt" }
        assert(!texte.contains("ctx.") && !texte.contains("Context")) {
            "FehlerTexte.kt darf keinen Context brauchen — sonst ist die Zuordnung " +
                "wieder nur mit Android-Laufzeit prüfbar"
        }
        val vm = Quellen.ohneKommentare(Quellen.lies("zustand/ui/viewmodel/AppTexte.kt"))
        val meldung = Quellen.funktion(vm, "override fun meldung(")
        assert(meldung.isNotEmpty()) { "meldung() fehlt in AppTexte" }
        assert(meldung.contains("fehlerTextId(")) {
            "meldung() benutzt die gemeinsame Zuordnung nicht mehr"
        }
    }
}
