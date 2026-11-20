package ch.brickinventoryapp.model.fach

// Der Katalog aller Sets.

data class KatalogSetAnsicht(
    val setNumber: String,
    val name: String? = null,
    val year: Int? = null,
    val themeId: Int? = null,
    val themeName: String? = null,
    val numParts: Int? = null,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val owned: Boolean = false,
    val ownedQuantity: Int = 0,
)

data class CatalogDetailView(
    val setNumber: String,
    val name: String? = null,
    val year: Int? = null,
    val themeId: Int? = null,
    val themeName: String? = null,
    val numParts: Int? = null,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val minifigs: Int = 0,
    val owned: Boolean = false,
    val ownedQuantity: Int = 0,
    val bricklink: BrickLinkView? = null,
    val preisvergleichUrl: String? = null,
)

data class JahrAnzahlAnsicht(
    val year: Int? = null,
    val n: Int = 0,
)

/** Themen und Jahresspanne für die Filter des Katalogs. */
data class CatalogMetaView(val themen: List<CatalogThemeView>, val jahrMin: Int?, val jahrMax: Int?)

/** Eine Seite des Katalogs; [gesamt] zählt alle Treffer des Filters. */
data class CatalogPageView(val sets: List<KatalogSetAnsicht>, val gesamt: Int)

/** Was ein Barcode ergab; [setNumber] leer heisst nicht gefunden, [unsicher] eine geratene Zuordnung. */
data class BarcodeView(
    val setNumber: String,
    val name: String? = null,
    val year: Int? = null,
    val pieces: Int? = null,
    val theme: String? = null,
    val minifigs: Int? = null,
    val bildUrl: String? = null,
    val bildLokal: String? = null,
    val unsicher: Boolean = false,
)

data class CatalogThemeView(
    val id: Int,
    val name: String,
    val setCount: Int = 0,
)
