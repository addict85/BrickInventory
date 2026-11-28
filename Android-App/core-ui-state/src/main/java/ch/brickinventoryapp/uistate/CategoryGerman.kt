package ch.brickinventoryapp.uistate

/**
 * Part categories from Rebrickable in German, word by word like [ColorGerman]: next to
 * „Farbe Rot“ there would otherwise stand „Kategorie Bricks“. Unknown words stay
 * English; the data itself stays English (filters and server work with it).
 */

object CategoryGerman {
    private val words: Map<String, String> = mapOf(
        "bricks" to "Steine", "brick" to "Stein", "plates" to "Platten", "plate" to "Platte", "tiles" to "Fliesen",
        "tile" to "Fliese", "sloped" to "schräg", "curved" to "gebogen", "round" to "rund", "special" to "speziell",
        "cones" to "Kegel", "dishes" to "Schalen", "wedged" to "keilförmig", "wedges" to "Keile",
        "baseplates" to "Grundplatten", "panels" to "Paneele", "windows" to "Fenster", "doors" to "Türen",
        "wheels" to "Räder", "tyres" to "Reifen", "tires" to "Reifen", "and" to "und", "or" to "oder",
        "plants" to "Pflanzen", "animals" to "Tiere", "minifig" to "Minifigur", "minifigs" to "Minifiguren",
        "accessories" to "Zubehör", "heads" to "Köpfe", "headwear" to "Kopfbedeckungen", "upper" to "Ober",
        "lower" to "Unter", "body" to "körper", "bars" to "Stangen", "ladders" to "Leitern", "fences" to "Zäune",
        "hinges" to "Scharniere", "arms" to "Arme", "turntables" to "Drehkränze", "supports" to "Stützen",
        "girders" to "Träger", "cranes" to "Kräne", "transportation" to "Fahrzeuge", "land" to "Land",
        "sea" to "Wasser", "air" to "Luft", "containers" to "Behälter", "flags" to "Flaggen", "signs" to "Schilder",
        "plastics" to "Folien", "cloth" to "Stoff", "stickers" to "Aufkleber", "magnets" to "Magnete",
        "holders" to "Halter", "mechanical" to "Mechanik", "pneumatics" to "Pneumatik", "string" to "Schnüre",
        "bands" to "Bänder", "reels" to "Rollen", "tubes" to "Rohre", "hoses" to "Schläuche", "other" to "Sonstiges",
        "beams" to "Balken", "pins" to "Pins", "axles" to "Achsen", "connectors" to "Verbinder", "gears" to "Zahnräder",
        "bushes" to "Buchsen", "joints" to "Gelenke", "steering" to "Lenkung", "suspension" to "Federung",
        "figures" to "Figuren", "large" to "grosse", "buildable" to "baubare", "parts" to "Teile",
        "projectiles" to "Geschosse", "launchers" to "Werfer", "electronics" to "Elektronik", "lights" to "Lichter",
        "printed" to "bedruckt", "decorated" to "verziert", "rock" to "Felsen", "food" to "Essen",
        "tools" to "Werkzeuge", "weapons" to "Waffen", "costumes" to "Kostüme",
    )

    /** Words written together with the following one („Ober“ + „körper“). */
    private val prefixes = setOf("Ober", "Unter")

    /** „Bricks Sloped“ → „Steine schräg“, „Minifig Upper Body“ → „Minifigur Oberkörper“. */
    fun translate(en: String): String {
        val parts = Regex("""(\s+|,|-)""").split(en.trim()).filter { it.isNotBlank() }
        val separator = Regex("""\s*(,|-)\s*|\s+""").findAll(en.trim()).map { it.value.trim() }.toList()
        val sb = StringBuilder()
        parts.forEachIndexed { i, word ->
            val de = words[word.lowercase()] ?: word
            if (i > 0) {
                val t = separator.getOrNull(i - 1).orEmpty()
                val before = words[parts[i - 1].lowercase()]
                if (before !in prefixes) sb.append(if (t.isEmpty()) " " else if (t == ",") ", " else " $t ")
            }
            sb.append(de)
        }
        return sb.toString()
    }
}
