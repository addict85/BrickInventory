package ch.brickinventoryapp.model.data.model

/**
 * Die Fehlercodes des Servers, nach denen die App verzweigt. Eine Aufzählung statt
 * verstreuter Zeichenketten, damit ein Tippfehler nicht übersetzt und
 * vertrag-kotlin.test.js jede Kennung gegen components.schemas.Fehlercode prüfen kann.
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
        private val nachKennung = entries.associateBy { it.kennung }

        /** Ein Code, den die App nicht kennt, ist null: Sie verzweigt dann nicht nach ihm. */
        fun aus(kennung: String?): Fehlercode? = kennung?.let { nachKennung[it] }
    }
}
