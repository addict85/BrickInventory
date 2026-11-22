package ch.brickinventoryapp.model.ui

/**
 * Color names from Rebrickable in German — the same rule as colorName() of the web app
 * (`public/i18n.js`): the names stay English in the data (BrickLink needs them),
 * only the display is translated, word by word, so that new colors become readable
 * too. Unknown words stay. The vocabulary is compared with the web app by
 * ColorGermanTest.
 */

object ColorGerman {
    val words: Map<String, String> = mapOf(
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

    /** Words that are written together with the following one in German. */
    val prefixes: Set<String> = setOf(
        "Dunkel", "Hell", "Mittel", "Leucht", "Perl", "Matt", "Neon", "Rötlich", "Bläulich",
        "Gelblich", "Sand", "Metallic", "Chrom", "Satin", "Opal", "Milchig", "Glitzer",
    )

    /** „Dark Bluish Gray“ → „Dunkelbläulichgrau“, „Trans-Clear“ → „Trans-Klar“. */
    fun translate(en: String): String {
        val out = wordsAndSeparator(en).map { t ->
            when {
                t.isNotEmpty() && t.isBlank() -> " "
                t == "-" -> "-"
                else -> words[t.lowercase()] ?: t
            }
        }
        val sb = StringBuilder()
        var append = false
        for (t in out) {
            if (t == " ") {
                if (!append) sb.append(' ')
                continue
            }
            if (t == "-") { sb.append('-'); append = false; continue }
            sb.append(if (append) t.replaceFirstChar { it.lowercaseChar() } else t)
            append = t in prefixes
        }
        return sb.toString().replace(Regex("""\s{2,}"""), " ").trim()
    }

    /** Like `split(/(\s+|-)/)` in JavaScript: words AND separators, in their order. */
    private fun wordsAndSeparator(s: String): List<String> {
        val from = mutableListOf<String>()
        var rest = 0
        for (m in Regex("""\s+|-""").findAll(s)) {
            from += s.substring(rest, m.range.first)
            from += m.value
            rest = m.range.last + 1
        }
        from += s.substring(rest)
        return from
    }
}
