package ch.brickinventoryapp.ui

sealed class Screen(val route: String) {
    object Setup    : Screen("setup")
    object Login    : Screen("login")
    object Gallery  : Screen("gallery")
    object Catalog  : Screen("catalog")
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
