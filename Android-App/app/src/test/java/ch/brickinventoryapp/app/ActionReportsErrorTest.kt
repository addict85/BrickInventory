package ch.brickinventoryapp.app

import org.junit.Test
import ch.brickinventoryapp.testing.Sources

/**
 * What the user triggers also reports when it fails.
 *
 * ── The finding ──────────────────────────────────────────────────────────────
 * Of twenty-one changing functions of the ViewModel, nineteen reported their
 * error. Two did not:
 *
 *   HouseholdFeature.unlinkHousehold        is Result.Error -> {}
 *   ManualItemFeature.deleteManualAcquisition  is Result.Error -> {}
 *
 * Both have a twin in the same file that does —
 * createHouseholdInvite, redeemHouseholdInvite, moveSet,
 * changeAcquisitionOwner on the one, updateManualAcquisition on the
 * other side. So the rule had long been in the code; these two
 * slipped through.
 *
 * For the user it looked like this: they tap „Verknüpfung lösen" or
 * delete, and visibly nothing happens. No success, no reason. One taps
 * once more.
 *
 * ── Why only the CHANGING ones ───────────────────────────────────────────────
 * Loading paths may fail silently when what is loaded is an extra — the
 * key figures at the top of the gallery, the color list in the add dialog. Both
 * carry the reasoning in the code by now. A message about a row of numbers
 * would be louder than its loss.
 *
 * With an action of the user it is the other way round: they wait for an answer.
 *
 * The functions are found, not enumerated — in
 * the ViewModels instead of in the *Feature.kt files. Counter-check (measured): in
 * HouseholdViewModel.unlinkHousehold() the error branch set to `{}` → red.
 */
class ActionReportsErrorTest {

    /** All functions of the ViewModels, per name. */
    private fun viewModelFunctions(): Map<String, String> {
        val files = Sources.below("ui").filter { it.name.endsWith("ViewModel.kt") }
        assert(files.size >= 10) {
            "Nur ${files.size} *ViewModel.kt gefunden — der Pfad stimmt nicht, und ein " +
                "leeres Ergebnis würde diesen Test stillschweigend bestehen lassen."
        }
        val header = Regex("""\n    (?:override |private |internal |protected )?(?:suspend )?fun (\w+)\(""")
        val outcome = linkedMapOf<String, String>()
        for (file in files) {
            val src = Sources.withoutComments(file.readText())
            val hits = header.findAll(src).toList()
            for ((k, m) in hits.withIndex()) {
                val end = hits.getOrNull(k + 1)?.range?.first ?: src.length
                outcome["${file.name}:${m.groupValues[1]}"] = src.substring(m.range.first, end)
            }
        }
        assert(outcome.size >= 40) { "Nur ${outcome.size} Funktionen gefunden — Muster veraltet?" }
        return outcome
    }

    @Test
    fun `every changing function reports its error`() {
        // Changing = it calls a writing path of the repository.
        val changing = Regex(
            """\b(?:repo|sets|parts|finances|household|admin|account|vouchers)\.(?:\w+\.)?(add|delete|update|unlink|invite|redeem|create|remove|save|move|change)\w*\(""",
            RegexOption.IGNORE_CASE)
        val still = Regex("""is Outcome\.Failure\s*->\s*\{\s*\}""")

        val silent = mutableListOf<String>()
        var checked = 0
        for ((name, body) in viewModelFunctions()) {
            if (!changing.containsMatchIn(body)) continue
            checked++
            if (still.containsMatchIn(body)) silent += name
        }

        assert(checked >= 15) {
            "Nur $checked ändernde Funktionen erkannt — das Muster findet zu wenig, " +
                "und ein leeres Ergebnis unten sagt dann nichts."
        }

        assert(silent.isEmpty()) {
            "Diese Handlungen scheitern lautlos:\n  " + silent.joinToString("\n  ") +
                "\nDer Nutzer tippt, es passiert sichtbar nichts, und er erfährt " +
                "keinen Grund. Fehler melden — über den Weg, den die Nachbarn " +
                "derselben Datei benutzen."
        }
    }
}
