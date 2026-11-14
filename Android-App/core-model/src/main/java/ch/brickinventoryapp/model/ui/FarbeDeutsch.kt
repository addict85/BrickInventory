package ch.brickinventoryapp.model.ui

/**
 * Farbnamen von Rebrickable auf Deutsch — dieselbe Regel wie colorName() der Webapp
 * (public/i18n.js): Die Namen bleiben in den Daten englisch (BrickLink braucht sie),
 * übersetzt wird nur die Anzeige, Wort für Wort, damit auch neue Farben lesbar
 * werden. Unbekannte Wörter bleiben stehen. Den Wortschatz gleicht FarbeDeutschTest
 * mit der Webapp ab.
 */

object FarbeDeutsch {
    val woerter: Map<String, String> = mapOf(
        // Modifikatoren
        "dark" to "Dunkel", "light" to "Hell", "medium" to "Mittel", "bright" to "Leucht", "very" to "Sehr",
        "reddish" to "Rötlich", "bluish" to "Bläulich", "yellowish" to "Gelblich", "dark-" to "Dunkel",
        "trans" to "Trans", "transparent" to "Transparent", "neon" to "Neon", "glitter" to "Glitzer",
        "speckle" to "Gesprenkelt", "metallic" to "Metallic", "pearl" to "Perl", "satin" to "Satin",
        "chrome" to "Chrom", "flat" to "Matt", "opal" to "Opal", "milky" to "Milchig", "glow" to "Leucht",
        "in" to "im", "the" to "", "dark2" to "Dunkeln", "fabuland" to "Fabuland", "modulex" to "Modulex",
        // Grundfarben
        "red" to "Rot", "blue" to "Blau", "green" to "Grün", "yellow" to "Gelb", "white" to "Weiss",
        "black" to "Schwarz", "gray" to "Grau", "grey" to "Grau", "brown" to "Braun", "orange" to "Orange",
        "purple" to "Violett", "violet" to "Violett", "pink" to "Rosa", "tan" to "Beige", "lime" to "Limette",
        "azure" to "Azur", "aqua" to "Aquamarin", "magenta" to "Magenta", "olive" to "Oliv", "sand" to "Sand",
        "salmon" to "Lachs", "gold" to "Gold", "silver" to "Silber", "copper" to "Kupfer", "bronze" to "Bronze",
        "clear" to "Klar", "nougat" to "Nougat", "lavender" to "Lavendel", "turquoise" to "Türkis",
        "coral" to "Koralle", "maroon" to "Kastanie", "teal" to "Petrol", "beige" to "Beige", "rust" to "Rost",
        "khaki" to "Khaki", "ochre" to "Ocker", "plum" to "Pflaume", "burgundy" to "Bordeaux",
        "unknown" to "Unbekannt", "none" to "Ohne", "no" to "Kein", "color" to "Farbe", "colour" to "Farbe",
    )

    /** Wörter, die im Deutschen mit dem folgenden zusammengeschrieben werden. */
    val vorsilben: Set<String> = setOf(
        "Dunkel", "Hell", "Mittel", "Leucht", "Perl", "Matt", "Neon", "Rötlich", "Bläulich",
        "Gelblich", "Sand", "Metallic", "Chrom", "Satin", "Opal", "Milchig", "Glitzer",
    )

    /** „Dark Bluish Gray“ → „Dunkelbläulichgrau“, „Trans-Clear“ → „Trans-Klar“. */
    fun uebersetze(en: String): String {
        val raus = woerterUndTrenner(en).map { t ->
            when {
                t.isNotEmpty() && t.isBlank() -> " "
                t == "-" -> "-"
                else -> woerter[t.lowercase()] ?: t
            }
        }
        val sb = StringBuilder()
        var anhaengen = false
        for (t in raus) {
            if (t == " ") {
                if (!anhaengen) sb.append(' ')
                continue
            }
            if (t == "-") { sb.append('-'); anhaengen = false; continue }
            sb.append(if (anhaengen) t.replaceFirstChar { it.lowercaseChar() } else t)
            anhaengen = t in vorsilben
        }
        return sb.toString().replace(Regex("""\s{2,}"""), " ").trim()
    }

    /** Wie `split(/(\s+|-)/)` in JavaScript: Wörter UND Trenner, in ihrer Reihenfolge. */
    private fun woerterUndTrenner(s: String): List<String> {
        val aus = mutableListOf<String>()
        var rest = 0
        for (m in Regex("""\s+|-""").findAll(s)) {
            aus += s.substring(rest, m.range.first)
            aus += m.value
            rest = m.range.last + 1
        }
        aus += s.substring(rest)
        return aus
    }
}
