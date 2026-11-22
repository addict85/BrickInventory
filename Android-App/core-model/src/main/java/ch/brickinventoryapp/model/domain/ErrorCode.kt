package ch.brickinventoryapp.model.domain

/**
 * The server's error codes the app branches on. An enumeration instead of
 * scattered strings, so that a typo does not compile and
 * tools/contract/contract-kotlin.test.js can check every identifier against components.schemas.Fehlercode.
 */

enum class ErrorCode(val identifier: String) {
    CURRENT_PASSWORD_REQUIRED("aktuelles_passwort_erforderlich"),
    CURRENT_PASSWORD_WRONG("aktuelles_passwort_falsch"),
    BARCODE_NO_SET("barcode_kein_set"),
    BALANCE_SPACING("guthaben_abstand"),
    BALANCE_BOT_GUARD("guthaben_botschutz"),
    ONLY_ADMINS("nur_admins"),
    PASSKEY_INVALID("passkey_ungueltig"),
    PASSWORD_SWITCH_NEEDED("passwort_wechsel_noetig"),
    PDF_TOO_MANY_PAGES("pdf_zu_viele_seiten"),
    TOKEN_ROTATION_NEEDED("token_rotation_noetig"),
    TOKEN_INVALID("token_ungueltig"),
    UPLOAD_RUNNING("upload_laeuft"),
    TOO_MANY_REQUESTS("zu_viele_anfragen"),
    TOO_MANY_FAILED_ATTEMPTS("zu_viele_fehlversuche"),
    TOO_MANY_CONNECTIONS("zu_viele_verbindungen"),
    SECOND_FACTOR_WRONG("zweiter_faktor_falsch"),
    SECOND_FACTOR_NEEDED("zweiter_faktor_noetig"),
    SECOND_FACTOR_REQUIRED("zweiter_faktor_pflicht");

    companion object {
        private val afterId = entries.associateBy { it.identifier }

        /** A code the app does not know is null: it then does not branch on it. */
        fun from(identifier: String?): ErrorCode? = identifier?.let { afterId[it] }
    }
}
