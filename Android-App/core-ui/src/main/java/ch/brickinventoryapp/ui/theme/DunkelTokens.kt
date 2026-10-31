package ch.brickinventoryapp.ui.theme

/**
 * ERZEUGT aus shared/design-tokens.json — NICHT von Hand aendern.
 *
 * Die dunkle Variante JE Design, aktiv mit <html data-dunkel> (Geraetewahl
 * „Dunkel, wenn das System dunkel ist“). Vorher bekam, wer dunkel wollte,
 * das Design „werkbank“ — also ein anderes Design. 'basis' belegt
 * Flaechen, Grau-Achse und Meldefarben fuer alle Designs (dieselben Rollen
 * wie in themes/werkbank.css); je Design stehen nur die Markenfarben,
 * aufgehellt, damit Text und Linien in ihnen auf dunklem Grund lesbar
 * bleiben. Schrift auf der Markenfarbe ist dann dunkel (--auf-primaer).
 * Werkbank ist schon dunkel und hat keine Variante. Beide Oberflaechen
 * lesen diesen Abschnitt: Der Generator erzeugt daraus die dunklen Bloecke
 * in public/tokens.css und die App-Tabelle ui/theme/DunkelTokens.kt.
 *
 * Erzeugt von Web-App/scripts/generate-design-tokens.js. Die Regeln dazu
 * (erbt, Material-Rollen) stehen in DunkleRollen.kt.
 */
object DunkelTokens {
    val basis: Map<String, String> = mapOf(
        "s50" to "#11151a",
        "s100" to "#161b21",
        "s200" to "#262d36",
        "s300" to "#2f3843",
        "s400" to "#6f7986",
        "s500" to "#8d96a3",
        "s600" to "#b6bec9",
        "s700" to "#cfd6de",
        "s800" to "#e6e9ed",
        "bg" to "#14181d",
        "sur" to "#1b2027",
        "bdr" to "#2f3843",
        "txt" to "#e6e9ed",
        "mut" to "#9aa3af",
        "screen-bg" to "#14181d",
        "auf-primaer" to "#0b1a2e",
        "g100" to "#1d2a20",
        "g500" to "#6fbf7f",
        "g700" to "#7fcf8f",
        "gewinn" to "#7fcf8f",
        "r100" to "#2c1c1c",
        "r500" to "#e07a72",
        "r700" to "#f08c84",
        "a100" to "#2a2418",
        "a500" to "#d9a84e",
        "a-schrift" to "#e0b462",
        "p100" to "#241d2e",
        "p600" to "#b087d6",
    )

    val designs: Map<String, Map<String, String>> = mapOf(
        "classic" to mapOf(
            "b50" to "#13233d",
            "b100" to "#172c4d",
            "b200" to "#1e3a63",
            "b300" to "#2b4f85",
            "b400" to "#3f6db5",
            "b500" to "#5b8def",
            "b600" to "#7ab0ff",
            "b700" to "#a9caff",
            "chart-new" to "#7ab0ff",
            "chart-used" to "#f0a54a",
        ),
        "brick" to mapOf(
            "b50" to "#18222d",
            "b100" to "#1d2a38",
            "b200" to "#273849",
            "b300" to "#35506a",
            "b400" to "#4c6f93",
            "b500" to "#7397bd",
            "b600" to "#93b6dc",
            "b700" to "#bcd3ec",
            "chart-new" to "#93b6dc",
            "chart-used" to "#c9a46a",
        ),
        "farbfaecher" to mapOf(
            "b50" to "#1c1c1c",
            "b100" to "#242424",
            "b200" to "#333333",
            "b300" to "#4a4a4a",
            "b400" to "#6e6e6e",
            "b500" to "#a0a0a0",
            "b600" to "#d6d6d6",
            "b700" to "#f0f0f0",
            "chart-new" to "#7ab0ff",
            "chart-used" to "#f0a54a",
        ),
        "noppe" to mapOf(
            "b50" to "#2a1415",
            "b100" to "#3a1a1c",
            "b200" to "#5a2226",
            "b300" to "#8a2c32",
            "b400" to "#c43c43",
            "b500" to "#e8585f",
            "b600" to "#ff7479",
            "b700" to "#ffa4a8",
            "chart-new" to "#6aa8ff",
            "chart-used" to "#ff9a40",
            "ink" to "#05070a",
        ),
        "hochglanz" to mapOf(
            "erbt" to "noppe",
        ),
    )
}
