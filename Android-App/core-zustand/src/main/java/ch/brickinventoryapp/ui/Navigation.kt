package ch.brickinventoryapp.ui

sealed class Screen(val route: String) {
    object Setup    : Screen("setup")
    object Login    : Screen("login")
    object Gallery  : Screen("gallery")
    object Catalog  : Screen("catalog")
    object Wanted : Screen("wanted")
    /**
     * Zustand IM PFAD: Dasselbe Set kann zweimal auf der Liste stehen (neu und
     * gebraucht), und „zeig mir den Merkposten auf 75192" waere mehrdeutig.
     */
    object MerkpostenDetail : Screen("merkposten_detail/{setNumber}/{condition}") {
        fun createRoute(setNumber: String, condition: String) =
            "merkposten_detail/${routenSegment(setNumber)}/${routenSegment(condition)}"
    }
    object CatalogDetail : Screen("catalog_detail/{setNumber}") {
        fun createRoute(setNumber: String) = "catalog_detail/${routenSegment(setNumber)}"
    }
    object SetDetail : Screen("set_detail/{setNumber}") {
        fun createRoute(setNumber: String) = "set_detail/${routenSegment(setNumber)}"
    }
    object Parts    : Screen("parts")
    object Finance  : Screen("finance")
    object Minifigs : Screen("minifigs")
    object PartsList : Screen("partslist")
    object Settings : Screen("settings")
    /** Alles, was kein Bestandsreiter ist — das fünfte Ziel der unteren Leiste. */
    object Mehr : Screen("mehr")

    // ── Die Unterseiten der Einstellungen ──
    //
    // Jede Rubrik hat eine eigene Route, keine Route mit Parameter
    // („einstellungen/{bereich}“): ErreichbareRoutenTest sucht nach einem
    // ausgeschriebenen `navigate(Screen.X.route)`, und ein Bildschirm, zu dem nur ein
    // zusammengesetzter String führt, wäre für die Prüfung unerreichbar.
    object Gutscheine : Screen("einstellungen_gutscheine")
    object Preisalarme : Screen("einstellungen_preisalarme")
    object Lagerorte : Screen("einstellungen_lagerorte")
    object Haushalt : Screen("einstellungen_haushalt")
    object CsvImport : Screen("einstellungen_csv")
    object Konto : Screen("einstellungen_konto")
    object BarcodeScanner : Screen("barcode_scanner")
    object Comparison : Screen("comparison")
    object Monitoring : Screen("monitoring")
    // type: "set" | "part" | "fig"
    object AcquisitionManagement : Screen("acq_mgmt/{type}/{id}/{colorId}/{title}") {
        fun createRoute(type: String, id: String, colorId: Int = ch.brickinventoryapp.data.model.KEINE_FARBE, title: String) =
            "acq_mgmt/${routenSegment(type)}/${routenSegment(id)}/$colorId/${routenSegment(title)}"
    }
    // Detailansicht eines manuell erfassten Teils / einer Minifigur — ein
    // ganzer Screen wie beim Set, nicht mehr ein Dialog. type: "part" | "fig"
    object ManualItemDetail : Screen("manual_detail/{type}/{id}/{colorId}/{title}") {
        fun createRoute(type: String, id: String, colorId: Int = ch.brickinventoryapp.data.model.KEINE_FARBE, title: String) =
            "manual_detail/${routenSegment(type)}/${routenSegment(id)}/$colorId/${routenSegment(title)}"
    }
    object PdfViewer : Screen("pdf_viewer/{url}/{title}") {
        fun createRoute(url: String, title: String) =
            "pdf_viewer/${routenSegment(url)}/${routenSegment(title)}"
    }
}

/**
 * Ein Wert als genau ein Pfadsegment. Navigation dekodiert Pfadargumente selbst mit
 * Uri.decode, das „+“ stehen lässt; darum Leerzeichen als %20 statt „+“, und das Ziel
 * liest das Argument unverändert. URLEncoder statt android.net.Uri, damit JVM-Tests die
 * Routen ohne Robolectric bauen können.
 */
internal fun routenSegment(wert: String): String =
    java.net.URLEncoder.encode(wert, "UTF-8").replace("+", "%20")

/**
 * Welche Unterseite der Einstellungen gemeint ist.
 *
 * Der Bildschirm nennt den BEREICH, der Graph kennt die Route — er ist der
 * einzige mit einem NavController. Ein einzelner Rueckruf mit diesem Wert
 * statt sechs einzelner Rueckrufe haelt die Signatur von SettingsScreen
 * schmal (hoechstens sechs Parameter, ScreenViewModelWiringTest).
 */
