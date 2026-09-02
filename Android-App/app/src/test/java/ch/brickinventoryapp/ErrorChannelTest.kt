package ch.brickinventoryapp

import org.junit.Test

/**
 * Ein Fehler, den der Nutzer nicht sieht, ist kein behandelter Fehler.
 *
 * ── Woher dieser Test kommt (Nachtrag 118) ──────────────────────────────────
 *
 * `AppUiState` hatte ein Feld `error`. Vier Feature-Dateien beschrieben es —
 * Anmeldung, Galerie, Teile, Finanzen, vierundzwanzig Stellen. GELESEN wurde es
 * an genau EINER: dem Anmeldebildschirm (`AuthGraph`). Achtzehn Fehlerpfade
 * schrieben also in ein Feld, das niemand anzeigt.
 *
 * Für den Nutzer hiess das: Ein misslungenes Löschen einer Minifigur, ein
 * fehlgeschlagener Bewertungsabruf, eine Galerie, die nicht lädt — nichts.
 * Keine Meldung, keine Erklärung, nur eine Liste, die sich nicht ändert.
 * `clearError()` hatte dazu passend null Aufrufer; das Feld wurde nur beim
 * Abmelden mit dem ganzen Zustand geleert.
 *
 * Die Ursache war ein zweiter, unfertiger Meldungsweg neben `_snackbar`. Beide
 * gab es, eine Regel welcher wofür gilt gab es nicht, und einer war nirgends
 * verdrahtet. Auffällig ist, dass es einmal schon aufgefallen WAR: Der
 * Kommentar über `meldeFehlgeschlageneErfassung()` in GalleryFeature.kt
 * beschreibt genau dieses Problem — behoben wurde damals nur die eine Stelle,
 * an der es jemand bemerkt hatte.
 *
 * Die Regel lautet jetzt:
 *  - flüchtige Meldungen → `_snackbar`
 *  - bleibende Formularfehler → `loginError` (nur Anmeldung; steht im Formular,
 *    während der Nutzer das Passwort korrigiert)
 *  - ganzseitige Fehlerflächen → das `error` des jeweiligen Bereichszustands
 *    (nur `CatalogUiState`, und der Katalog zeigt es auch)
 */
class ErrorChannelTest {

    private val featureDateien
        get() = Quellen.alle().filter { it.name.endsWith("Feature.kt") }

    @Test
    fun `nur die Anmeldung schreibt loginError`() {
        val schreiber = featureDateien
            .filter { Quellen.ohneKommentare(it.readText()).contains("loginError =") }
            .map { it.name }
        assert(schreiber.isNotEmpty()) {
            "Niemand schreibt loginError — dann kann der Anmeldebildschirm keinen " +
                "Fehler mehr zeigen. Muster veraltet?"
        }
        assert(schreiber == listOf("SessionFeature.kt")) {
            "loginError wird ausserhalb der Anmeldung beschrieben: ${schreiber.joinToString()}. " +
                "Das Feld wird NUR im Anmeldeformular gelesen — anderswo geschrieben ist " +
                "es eine Meldung, die niemand sieht."
        }
    }

    @Test
    fun `jedes geschriebene Zustandsfeld wird auch irgendwo gelesen`() {
        // Der allgemeine Fall des Fehlers oben: ein Feld, in das geschrieben,
        // aus dem aber nie gelesen wird. Geprüft für AppUiState, weil dort das
        // gemeinsame Objekt liegt und der Übergriff am leichtesten passiert.
        val quelle = Quellen.ohneKommentare(Quellen.lies("ui/UiState.kt"))
        val block = quelle.substringAfter("data class AppUiState(").substringBefore("\n)")
        val felder = Regex("""val\s+(\w+)\s*:""").findAll(block).map { it.groupValues[1] }.toList()
        // Untergrenze gegen ein veraltetes Muster, nicht gegen einen Sollwert:
        // AppUiState hatte 25 Felder, seit der Galerie-Aufteilung sind es 15.
        // Die Grenze liegt darunter, damit ein leerer Treffer weiterhin
        // auffaellt — wie klein das Objekt sein DARF, prueft
        // ZustandsflussBreiteTest, und zwar von der anderen Seite.
        assert(felder.size >= 10) { "Nur ${felder.size} Felder gefunden — Muster veraltet?" }

        // Gelesen wird ausserhalb des ViewModels: in Bildschirmen, Dialogen und
        // Navigationsgraphen. Das ViewModel selbst zählt NICHT als Leser — es
        // schreibt das Feld ja, und genau darum ging es.
        val leser = Quellen.unter("screens") + Quellen.unter("dialogs") + Quellen.unter("nav") +
            Quellen.alle().filter {
                it.name in setOf("AppNavigation.kt", "MainActivity.kt", "MainScaffold.kt")
            }
        assert(leser.size >= 20) { "Nur ${'$'}{leser.size} Leser-Dateien gefunden — Muster veraltet?" }
        val leserQuellen = leser.joinToString("\n") { Quellen.ohneKommentare(it.readText()) }

        // `authToken` und `serverUrl` gehen an Bildkomponenten und den
        // PDF-Betrachter, `scopeModes` an ScopeFilter — die tauchen als
        // Parameter auf, nicht als `state.feld`. Deshalb wird auf den blossen
        // Feldnamen geprüft, nicht auf den qualifizierten Zugriff.
        // Felder, die BEWUSST nur im ViewModel leben. Kurz halten: Jeder
        // Eintrag ist ein Feld, dessen Nutzen niemand mehr nachprüft.
        val nurIntern = mapOf(
            "galleryPage" to "Seitenzähler des Endlos-Scrolls; die Oberfläche sieht nur die Liste",
        )
        val ungelesen = felder.filter { feld ->
            feld !in nurIntern && !Regex("""\b$feld\b""").containsMatchIn(leserQuellen)
        }
        val totIntern = nurIntern.keys.filter { feld ->
            !Regex("""\b$feld\b""").containsMatchIn(
                featureDateien.joinToString("\n") { Quellen.ohneKommentare(it.readText()) }
            )
        }
        assert(totIntern.isEmpty()) {
            "Diese Ausnahmen werden nicht mehr gebraucht: ${'$'}{totIntern.joinToString()}"
        }
        assert(ungelesen.isEmpty()) {
            "Diese Felder von AppUiState werden geschrieben, aber nirgends in der " +
                "Oberfläche gelesen: ${ungelesen.joinToString()}. Entweder fehlt die " +
                "Anzeige, oder das Feld ist tot."
        }
    }

    /*
     * KEIN dritter Test „jeder Result.Error-Zweig meldet etwas".
     *
     * Ich habe ihn gebaut und wieder verworfen: Er fand zwanzig Zweige, und die
     * meisten sind zu Recht still. Ein misslungener Hintergrund-Nachladevorgang
     * behält den letzten Stand, statt zu nörgeln (SetDetailFeature, Preisverlauf,
     * Katalog-Metadaten); die Haushaltsliste bleibt ohne Haushalt einfach leer.
     * Zwanzig Ausnahmen sind keine Regel — dieselbe Überlegung wie beim
     * Geltungsbereich von StateDomainBoundaryTest.
     *
     * Was den ursprünglichen Fehler wirklich verhindert, steht im Test darüber:
     * ein Feld, in das geschrieben und aus dem nie gelesen wird, fällt auf.
     */
}
