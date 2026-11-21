package ch.brickinventoryapp.model.domain

/**
 * The server's error codes the app branches on. An enumeration instead of
 * scattered strings, so that a typo does not compile and
 * tools/contract/contract-kotlin.test.js can check every identifier against components.schemas.Fehlercode.
 */

enum class Fehlercode(val kennung: String) {
    AKTUELLES_PASSWORT_ERFORDERLICH("aktuelles_passwort_erforderlich"),
    AKTUELLES_PASSWORT_FALSCH("aktuelles_passwort_falsch"),
    BARCODE_KEIN_SET("barcode_kein_set"),
    GUTHABEN_ABSTAND("guthaben_abstand"),
    GUTHABEN_BOTSCHUTZ("guthaben_botschutz"),
    NUR_ADMINS("nur_admins"),
    PASSKEY_UNGUELTIG("passkey_ungueltig"),
    PASSWORT_WECHSEL_NOETIG("passwort_wechsel_noetig"),
    PDF_ZU_VIELE_SEITEN("pdf_zu_viele_seiten"),
    TOKEN_ROTATION_NOETIG("token_rotation_noetig"),
    TOKEN_UNGUELTIG("token_ungueltig"),
    UPLOAD_LAEUFT("upload_laeuft"),
    ZU_VIELE_ANFRAGEN("zu_viele_anfragen"),
    ZU_VIELE_FEHLVERSUCHE("zu_viele_fehlversuche"),
    ZU_VIELE_VERBINDUNGEN("zu_viele_verbindungen"),
    ZWEITER_FAKTOR_FALSCH("zweiter_faktor_falsch"),
    ZWEITER_FAKTOR_NOETIG("zweiter_faktor_noetig"),
    ZWEITER_FAKTOR_PFLICHT("zweiter_faktor_pflicht");

    companion object {
        private val afterId = entries.associateBy { it.kennung }

        /** A code the app does not know is null: it then does not branch on it. */
        fun aus(kennung: String?): Fehlercode? = kennung?.let { afterId[it] }
    }
}
