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
        // Die zehn Galerie-Felder stehen hier nicht mehr: Sie sind nach
        // GalleryUiState gewandert, genau wie die zwoelf Barcode-Felder in
        // Nachtrag 117. Der Anlass war diesmal die Rekomposition — SECHZEHN
        // Dateien sammeln `vm.state`, gelesen wurden die Galerie-Felder von
        // dreien. Und wieder hat der zweite Test unten die zugehoerigen
        // Ausnahmen als tot gemeldet, statt sie liegen zu lassen.
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
        "isLoggedIn" to "Session", "isAdmin" to "Session",
        "authToken" to "Session", "serverUrl" to "Session",
        // `loginLaeuft` hiess `isLoading` und stand bis zuletzt in `querschnitt`
        // darunter — als EINZIGES Feld, das jeder beschreiben durfte. Es hat
        // jetzt einen Eigner, weil es nur noch eine Bedeutung hat.
        "loginLaeuft" to "Session",
        // Seit Nachtrag 118 gehört der Anmeldefehler ausdrücklich der Sitzung
        // und ist NICHT mehr querschneidend — vorher hiess er `error`, durfte
        // von jedem beschrieben werden, und genau das war der Fehler.
        "loginError" to "Session",
        // Haushalt
        "scopeModes" to "Household", "householdMembers" to "Household",
    )

    /**
     * Querschneidende Felder — Felder, die JEDE Feature-Datei beschreiben darf.
     *
     * Die Menge ist LEER, und das ist das Ergebnis, nicht der Ausgangspunkt.
     * Zuletzt stand hier `isLoading`. NACHGEMESSEN: vier Feature-Dateien
     * schrieben es an dreiundzwanzig Stellen, fünf Stellen lasen es — und die
     * fünf meinten vier verschiedene Dinge (Anmeldung, Galerie, Bewertung, und
     * die Teileliste schrieb es, ohne dass ein Teile-Bildschirm es je las).
     *
     * Genau das ist der Schaden, den ein querschneidendes Feld anrichtet: Es
     * sieht nach einem gemeinsamen Begriff aus und ist in Wahrheit vier. Wer
     * schneller fertig war, gewann — `loadValuation()` beendete am Ende die
     * Ladeanzeige eines noch laufenden Galerie-Abrufs.
     *
     * Ein neuer Eintrag hier ist deshalb kein Formalismus, sondern die
     * Entscheidung, dieses Muster wieder zuzulassen. Die dritte Prüfung unten
     * hält die Menge deshalb ausdrücklich leer.
     */
    private val querschnitt = emptySet<String>()

    /**
     * Ausnahmen, jede mit Grund. Kurz halten: Jeder Eintrag hier ist eine
     * Stelle, an der die Trennung nicht gilt.
     */
    private val ausnahmen = mapOf(
        // Die Finanzübersicht bekommt die Währung des Kontos in derselben
        // Antwort wie die Bewertung — ein zweiter Abruf nur für die Währung
        // wäre eine Anfrage mehr für denselben Wert.
        ("Finance" to "currency") to
            "Währung kommt in der Bewertungsantwort mit",
    )
    // Zwei Ausnahmen sind mit der Galerie-Aufteilung entfallen — beide
    // betrafen Schreibzugriffe auf Felder, die es in AppUiState nicht mehr
    // gibt: „Barcode → gallerySearchFoundSetNumber" und „SetDetail → sets".
    // Der Test darunter hat sie als tot gemeldet; das ist genau der Ausgang,
    // den sein Kommentar beschreibt.

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

    /**
     * Aus dem gemeinsamen Zustand darf eine Feature-Datei nur LESEN, was ihr
     * gehört — mit Grund eingetragene Ausnahmen ausgenommen.
     *
     * ── Warum lesen genauso zählt wie schreiben ─────────────────────────────
     * Die erste Prüfung oben deckt nur Schreibzugriffe ab, und genau daran ist
     * `isLoading` vorbeigekommen: Es stand in `querschnitt`, also durfte jeder
     * es schreiben — und `loadMoreSets()` in GalleryFeature hängte seinen
     * Wächter daran. Damit sperrte JEDER fremde Abruf (Anmeldung, Teileliste,
     * Bewertung) das Nachladen der Galerie, und niemand konnte das an einer
     * einzelnen Zeile sehen: Der Schreiber stand in einer anderen Datei als der
     * Leser.
     *
     * Ein Wächter, der an einem Feld hängt, das eine FREMDE Domäne setzt, ist
     * eine Kopplung ohne Vertrag. Diese Prüfung macht sie sichtbar.
     */
    @Test
    fun `eine Feature-Datei liest aus dem gemeinsamen Zustand nur ihr Eigenes`() {
        // Ausnahmen, jede mit Grund — wie oben, kurz halten.
        val leseAusnahmen = mapOf(
            // Die Serveradresse ist keine Domänen-Information, sondern die
            // Grundlage jeder Anfrage. Sie kommt aus den Einstellungen und
            // ändert sich nur beim An- und Abmelden.
            ("PartsList" to "serverUrl") to "Basisadresse für den PDF-Export",
        )
        val fehler = mutableListOf<String>()
        for (datei in Quellen.alle().filter { it.name.endsWith("Feature.kt") }) {
            val feature = datei.name.removeSuffix("Feature.kt")
            val s = Quellen.ohneKommentare(datei.readText())
            for (m in Regex("""_state\.value\.(\w+)""").findAll(s)) {
                val feld = m.groupValues[1]
                val eigner = domaene[feld] ?: continue
                if (eigner == feature) continue
                if ((feature to feld) in leseAusnahmen.keys) continue
                fehler += "${datei.name} liest $feld (gehört zu $eigner)"
            }
        }
        assert(fehler.isEmpty()) {
            "Eine Feature-Datei hängt an einem Feld, das eine andere Domäne setzt. " +
                "Entweder gehört der Zustand in die eigene Domäne, oder die Ausnahme " +
                "braucht einen Eintrag MIT Grund:\n  " + fehler.distinct().joinToString("\n  ")
        }
    }

    /**
     * `querschnitt` bleibt leer.
     *
     * Kein Formalismus: Solange dort etwas steht, ist die erste Prüfung für
     * dieses Feld ausgeschaltet — und dann sagt kein Test mehr, wer es setzen
     * darf. Genau in dieser Lücke lebte `isLoading` mit vier Bedeutungen.
     * Ein neuer Eintrag soll eine bewusste Entscheidung sein, keine Beiläufigkeit.
     */
    @Test
    fun `es gibt kein querschneidendes Feld mehr`() {
        assert(querschnitt.isEmpty()) {
            "Diese Felder sind wieder von der Domänenprüfung ausgenommen: " +
                querschnitt.joinToString() + ".\nJedes davon darf jede Feature-Datei " +
                "beschreiben — und wer es liest, weiss nicht, wer es gesetzt hat."
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
