package ch.brickinventoryapp

import org.junit.Test

/**
 * Was der Nutzer anstösst, meldet sich auch, wenn es scheitert.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * Von einundzwanzig ändernden Funktionen des ViewModels meldeten neunzehn ihren
 * Fehler. Zwei nicht:
 *
 *   HouseholdFeature.unlinkHousehold        is Result.Error -> {}
 *   ManualItemFeature.deleteManualAcquisition  is Result.Error -> {}
 *
 * Beide haben einen Zwilling in derselben Datei, der es tut —
 * createHouseholdInvite, redeemHouseholdInvite, moveSet,
 * changeAcquisitionOwner auf der einen, updateManualAcquisition auf der
 * anderen Seite. Die Regel stand also längst im Code; diese zwei sind
 * durchgerutscht.
 *
 * Für den Nutzer sah es so aus: Er tippt auf „Verknüpfung lösen" oder auf
 * Löschen, und es passiert sichtbar nichts. Kein Erfolg, kein Grund. Man tippt
 * noch einmal.
 *
 * ── Warum nur die ÄNDERNDEN ─────────────────────────────────────────────────
 * Ladewege dürfen still scheitern, wenn das Geladene Beiwerk ist — die
 * Kennzahlen am Kopf der Galerie, die Farbliste im Erfassungsdialog. Beide
 * tragen die Begründung inzwischen im Code. Eine Meldung über eine Zahlenreihe
 * wäre lauter als ihr Verlust.
 *
 * Bei einer Handlung des Nutzers ist es umgekehrt: Er wartet auf eine Antwort.
 *
 * Die Funktionen werden gefunden, nicht aufgezählt.
 */
class AktionMeldetFehlerTest {

    /** Alle ViewModel-Funktionen der Feature-Dateien, je Name. */
    private fun viewModelFunktionen(): Map<String, String> {
        val ordner = java.io.File("src/main/java/ch/brickinventoryapp/ui")
        val dateien = (ordner.listFiles { f -> f.name.endsWith("Feature.kt") } ?: emptyArray()).toList()
        assert(dateien.size >= 5) {
            "Nur ${dateien.size} *Feature.kt gefunden — der Pfad stimmt nicht, und ein " +
                "leeres Ergebnis würde diesen Test stillschweigend bestehen lassen."
        }
        val ergebnis = linkedMapOf<String, String>()
        for (datei in dateien) {
            val src = Quellen.ohneKommentare(datei.readText())
            for (m in Regex("""internal fun MainViewModel\.(\w+)\(""").findAll(src)) {
                val start = m.range.first
                val ende = src.indexOf("\ninternal fun ", start + 10)
                ergebnis["${datei.name}:${m.groupValues[1]}"] =
                    src.substring(start, if (ende > start) ende else src.length)
            }
        }
        assert(ergebnis.size >= 40) { "Nur ${ergebnis.size} Funktionen gefunden — Muster veraltet?" }
        return ergebnis
    }

    @Test
    fun `jede aendernde Funktion meldet ihren Fehler`() {
        // Ändernd = sie ruft einen schreibenden Weg des Repositories.
        val aendernd = Regex(
            """repo\.\w+\.(add|delete|update|unlink|invite|redeem|create|remove|save|move|change)\w*\(""",
            RegexOption.IGNORE_CASE)
        val still = Regex("""is Result\.Error\s*->\s*\{\s*\}""")

        val stumm = mutableListOf<String>()
        var geprueft = 0
        for ((name, rumpf) in viewModelFunktionen()) {
            if (!aendernd.containsMatchIn(rumpf)) continue
            geprueft++
            if (still.containsMatchIn(rumpf)) stumm += name
        }

        assert(geprueft >= 15) {
            "Nur $geprueft ändernde Funktionen erkannt — das Muster findet zu wenig, " +
                "und ein leeres Ergebnis unten sagt dann nichts."
        }

        assert(stumm.isEmpty()) {
            "Diese Handlungen scheitern lautlos:\n  " + stumm.joinToString("\n  ") +
                "\nDer Nutzer tippt, es passiert sichtbar nichts, und er erfährt " +
                "keinen Grund. Fehler melden — über den Weg, den die Nachbarn " +
                "derselben Datei benutzen."
        }
    }
}
