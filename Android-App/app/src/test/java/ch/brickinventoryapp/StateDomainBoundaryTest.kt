package ch.brickinventoryapp

import org.junit.Test

/**
 * Wer darf welches Feld von `AppUiState` beschreiben?
 *
 * ── Woher dieser Test kommt (Nachtrag 116) ──────────────────────────────────
 *
 * INVARIANTEN.md sagt seit Langem „Zustand ist nach Domänen getrennt", und die
 * Aufteilung hat auch stattgefunden: `PartsUiState`, `FinanceUiState`,
 * `CatalogUiState`, `SetDetailUiState`, `HouseholdUiState` und `_snackbar`
 * leben je in eigenen Flüssen. Was fehlte, war die Durchsetzung: Jede der
 * zwölf Feature-Dateien hat über `internal` Schreibzugriff auf JEDEN Fluss und
 * jedes Feld. Die Trennung hing damit allein an Disziplin — und eine Regel,
 * die nur in einem Dokument steht, ist beim nächsten schnellen Fix weg.
 *
 * GELTUNGSBEREICH: geprüft wird `AppUiState`, also das GEMEINSAME Objekt. Die
 * eigenen Flüsse (Teile, Finanzen, Katalog, Haushalt, Barcode, …) sind hier
 * nicht abgedeckt — dort ist ein Zugriff von aussen die Ausnahme und meist
 * berechtigt (`logout()` setzt alle zurück, die Teileliste verbraucht den
 * gescannten Wert). Eine Prüfung darüber hätte sofort fünf Ausnahmen
 * gebraucht, und eine Regel mit fünf Ausnahmen ist keine.
 *
 * Der Test lässt bewusst zu, was heute da ist, statt eine Wunschordnung zu
 * behaupten. Sein Zweck ist, dass NEUE Übergriffe auffallen, nicht dass der
 * Bestand rot wird. Wächst hier eine Ausnahme, ist das das Signal, das Feld in
 * einen eigenen Zustand zu ziehen — so ist es bei Teilen und Finanzen auch
 * gelaufen.
 */
class StateDomainBoundaryTest {

    /** Feld → Domäne. Die Domäne ist der Name der Feature-Datei ohne "Feature.kt". */
    private val domaene = mapOf(
        // Galerie
        "sets" to "Gallery", "galleryQuery" to "Gallery", "galleryTheme" to "Gallery",
        "gallerySort" to "Gallery", "galleryThemes" to "Gallery", "galleryTotal" to "Gallery",
        "galleryPage" to "Gallery", "galleryLoadingMore" to "Gallery", "stats" to "Gallery",
        "gallerySearchFoundSetNumber" to "Gallery",
        // Die zwölf Barcode-Felder stehen hier nicht mehr: Sie sind in
        // Nachtrag 117 nach BarcodeUiState gewandert und damit gar nicht mehr
        // Teil des gemeinsamen Objekts. Das ist der erwünschte Ausgang — die
        // Ausnahme für PartsList entfiel dadurch, und der zweite Test unten
        // hat das gemeldet, statt sie stillschweigend liegen zu lassen.
        // Einstellungen
        "currency" to "Settings", "priceCondition" to "Settings",
        "defaultPriceCondition" to "Settings", "userDefaultCondition" to "Settings",
        "appTheme" to "Settings", "language" to "Settings",
        // Sitzung
        "isLoggedIn" to "Session", "isAdmin" to "Session", "username" to "Session",
        "authToken" to "Session", "serverUrl" to "Session",
        // Seit Nachtrag 118 gehört der Anmeldefehler ausdrücklich der Sitzung
        // und ist NICHT mehr querschneidend — vorher hiess er `error`, durfte
        // von jedem beschrieben werden, und genau das war der Fehler.
        "loginError" to "Session",
        // Haushalt
        "scopeModes" to "Household", "householdMembers" to "Household",
    )

    /**
     * Querschneidende Felder. Sie sind der Grund, warum es `AppUiState` als
     * gemeinsames Objekt überhaupt noch gibt. `PartsFeature` fasste siebzehnmal
     * auf `_state` zu — für `isLoading` und das frühere `error`. Seit Nachtrag
     * 118 bleibt nur `isLoading`; Fehler gehen in den Snackbar.
     */
    private val querschnitt = setOf("isLoading")

    /**
     * Ausnahmen, jede mit Grund. Kurz halten: Jeder Eintrag hier ist eine
     * Stelle, an der die Trennung nicht gilt.
     */
    private val ausnahmen = mapOf(
        // Der Scanner findet ein Set, das schon im Bestand liegt, und die
        // Galerie soll dorthin springen. Die Übergabe ist der Zweck des Scans;
        // sie über einen Rückruf zu führen, wäre derselbe Schreibzugriff mit
        // mehr Zeremonie.
        ("Barcode" to "gallerySearchFoundSetNumber") to
            "Scanner reicht den Treffer an die Galerie weiter",
        // Die Finanzübersicht bekommt die Währung des Kontos in derselben
        // Antwort wie die Bewertung — ein zweiter Abruf nur für die Währung
        // wäre eine Anfrage mehr für denselben Wert.
        ("Finance" to "currency") to
            "Währung kommt in der Bewertungsantwort mit",
        // applySetAggregate() schreibt das Zustands-Aggregat des Servers in die
        // Galerie-Liste zurück. Ohne das blieb die Kachel nach einer
        // Zustandsänderung im Kaufpreis-Dialog auf dem alten Label stehen, bis
        // die Liste vollständig neu geladen wurde. Der saubere Weg wäre, dass
        // die Kachel ihren Zustand nicht doppelt hält — das ist ein eigener
        // Umbau, kein Nebeneffekt dieses Tests.
        ("SetDetail" to "sets") to
            "Zustands-Aggregat wird in die Galerie-Kachel zurückgeschrieben",
    )

    @Test
    fun `jede Feature-Datei schreibt nur ihre eigenen Felder`() {
        val fehler = mutableListOf<String>()
        for (datei in Quellen.alle().filter { it.name.endsWith("Feature.kt") }) {
            val feature = datei.name.removeSuffix("Feature.kt")
            val s = Quellen.ohneKommentare(datei.readText())
            for (feld in geschriebeneFelder(s)) {
                if (feld in querschnitt) continue
                val eigner = domaene[feld] ?: continue   // Feld einer anderen Zustandsklasse
                if (eigner == feature) continue
                if ((feature to feld) in ausnahmen.keys) continue
                fehler += "${datei.name} schreibt $feld (gehört zu $eigner)"
            }
        }
        assert(fehler.isEmpty()) {
            "Übergriff in eine fremde Domäne. Entweder gehört das Feld woanders hin, " +
                "oder es braucht einen Eintrag in `ausnahmen` MIT Grund:\n  " +
                fehler.distinct().joinToString("\n  ")
        }
    }

    @Test
    fun `die Ausnahmenliste enthaelt nichts Totes`() {
        // Eine Ausnahme, die niemand mehr braucht, ist eine Erlaubnis, die
        // niemand mehr prüft. Sobald ein Übergriff verschwindet — etwa weil
        // das Feld in einen eigenen Zustand gezogen wurde — soll auch der
        // Eintrag hier weg.
        val tot = ausnahmen.keys.filter { (feature, feld) ->
            val datei = Quellen.alle().firstOrNull { it.name == "${feature}Feature.kt" }
                ?: return@filter true
            feld !in geschriebeneFelder(Quellen.ohneKommentare(datei.readText()))
        }
        assert(tot.isEmpty()) {
            "Diese Ausnahmen werden nicht mehr gebraucht und gehören gelöscht: " +
                tot.joinToString { "${it.first} → ${it.second}" }
        }
    }

    /** Feldnamen aus allen `_state.update { … .copy(feld = …) }` einer Datei. */
    private fun geschriebeneFelder(s: String): Set<String> {
        val felder = mutableSetOf<String>()
        Regex("""_state\.update\s*\{[^{]*?\.copy\(""").findAll(s).forEach { m ->
            // Bis zur passenden schliessenden Klammer lesen — ein festes
            // Zeichenfenster hätte lange copy()-Aufrufe abgeschnitten, und
            // genau die sind hier die interessanten (Nachtrag 115).
            var tiefe = 1
            val puffer = StringBuilder()
            for (c in s.substring(m.range.last + 1)) {
                if (c == '(') tiefe++
                else if (c == ')') { tiefe--; if (tiefe == 0) break }
                puffer.append(c)
            }
            felder += Regex("""(\w+)\s*=""").findAll(puffer).map { it.groupValues[1] }
        }
        return felder
    }
}
