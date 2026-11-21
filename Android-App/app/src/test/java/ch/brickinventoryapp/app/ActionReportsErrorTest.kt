package ch.brickinventoryapp.app

import org.junit.Test
import ch.brickinventoryapp.testing.Quellen

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
        val dateien = Quellen.unter("ui").filter { it.name.endsWith("ViewModel.kt") }
        assert(dateien.size >= 10) {
            "Nur ${dateien.size} *ViewModel.kt gefunden — der Pfad stimmt nicht, und ein " +
                "leeres Ergebnis würde diesen Test stillschweigend bestehen lassen."
        }
        val kopf = Regex("""\n    (?:override |private |internal |protected )?(?:suspend )?fun (\w+)\(""")
        val ergebnis = linkedMapOf<String, String>()
        for (datei in dateien) {
            val src = Quellen.withoutComments(datei.readText())
            val treffer = kopf.findAll(src).toList()
            for ((k, m) in treffer.withIndex()) {
                val ende = treffer.getOrNull(k + 1)?.range?.first ?: src.length
                ergebnis["${datei.name}:${m.groupValues[1]}"] = src.substring(m.range.first, ende)
            }
        }
        assert(ergebnis.size >= 40) { "Nur ${ergebnis.size} Funktionen gefunden — Muster veraltet?" }
        return ergebnis
    }

    @Test
    fun `every changing function reports its error`() {
        // Changing = it calls a writing path of the repository.
        val changing = Regex(
            """\b(?:repo|sets|teile|finanzen|haushalt|admin|konto|gutscheine)\.(?:\w+\.)?(add|delete|update|unlink|invite|redeem|create|remove|save|move|change)\w*\(""",
            RegexOption.IGNORE_CASE)
        val still = Regex("""is Ergebnis\.Fehler\s*->\s*\{\s*\}""")

        val stumm = mutableListOf<String>()
        var geprueft = 0
        for ((name, rumpf) in viewModelFunctions()) {
            if (!changing.containsMatchIn(rumpf)) continue
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
