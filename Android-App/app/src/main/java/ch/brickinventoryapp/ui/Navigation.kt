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
            "merkposten_detail/${java.net.URLEncoder.encode(setNumber, "UTF-8")}/$condition"
    }
    object CatalogDetail : Screen("catalog_detail/{setNumber}") {
        fun createRoute(setNumber: String) = "catalog_detail/$setNumber"
    }
    object SetDetail : Screen("set_detail/{setNumber}") {
        fun createRoute(setNumber: String) = "set_detail/$setNumber"
    }
    object Parts    : Screen("parts")
    object Finance  : Screen("finance")
    object Minifigs : Screen("minifigs")
    object PartsList : Screen("partslist")
    object Settings : Screen("settings")

    // ── Die Unterseiten der Einstellungen (Marcos Befund vom 16.10.) ────────
    //
    // „Generell wirkt dieser Dialog überladen und nicht liebevoll gestaltet.
    //  […] Evtl. Auch Elemente aus den Einstellungen in eine eigene Sicht
    //  verschieben?"
    //
    // Sieben Rubriken sind umgezogen; die Einstellungen zeigen nur noch eine
    // Liste dorthin. Eigene Routen und KEINE Route mit Parameter
    // („einstellungen/{bereich}"): ErreichbareRoutenTest sucht nach einem
    // ausgeschriebenen `navigate(Screen.X.route)`, und ein Bildschirm, zu dem
    // nur ein zusammengesetzter String fuehrt, waere fuer die Pruefung
    // unerreichbar — also genau das, was sie finden soll.
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
        private fun encode(s: String) = java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20")
        fun createRoute(type: String, id: String, colorId: Int = 0, title: String) =
            "acq_mgmt/$type/${encode(id)}/$colorId/${encode(title)}"
    }
    // Detailansicht eines manuell erfassten Teils / einer Minifigur — ein
    // ganzer Screen wie beim Set, nicht mehr ein Dialog. type: "part" | "fig"
    object ManualItemDetail : Screen("manual_detail/{type}/{id}/{colorId}/{title}") {
        private fun encode(s: String) = java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20")
        fun createRoute(type: String, id: String, colorId: Int = 0, title: String) =
            "manual_detail/$type/${encode(id)}/$colorId/${encode(title)}"
    }
    object PdfViewer : Screen("pdf_viewer/{url}/{title}") {
        private fun encode(s: String) = java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20")
        fun createRoute(url: String, title: String) =
            "pdf_viewer/${encode(url)}/${encode(title)}"
    }
}

/**
 * Welche Unterseite der Einstellungen gemeint ist.
 *
 * Der Bildschirm nennt den BEREICH, der Graph kennt die Route — er ist der
 * einzige mit einem NavController. Ein einzelner Rueckruf mit diesem Wert
 * statt sechs einzelner Rueckrufe haelt die Signatur von SettingsScreen
 * schmal (hoechstens sechs Parameter, ScreenViewModelWiringTest).
 */
enum class EinstellungsBereich {
    GUTSCHEINE, PREISALARME, LAGERORTE, HAUSHALT, CSV_IMPORT, KONTO
}
